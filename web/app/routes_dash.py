"""The dashboard: five pages rendered on the server, the boot screen, the sync bar and the account actions."""
import hmac
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from . import consent
from .dash.fmt import Fmt
from .dash.views import BUILDERS, PAGES, Page, portfolio_csv, projects_csv
from .i18n import pick_lang
from .pages import safe_next, templates
from .publish import can_publish
from .routes_api import run_publish
from .sessions import COOKIE, SessionStore, csrf_ok, current_user
from .store import Store, delete_everything, enqueue_extraction

router = APIRouter()
BUSY = ("queued", "running")
NO_STORE = {"Cache-Control": "no-store"}


def _store(request: Request) -> Store:
    return Store(request.app.state.memory, request.app.state.settings)


def _ms(iso: str | None) -> float | None:
    try:
        return datetime.fromisoformat(iso).timestamp() * 1000 if iso else None
    except ValueError:
        return None


def wait_text(f: Fmt, seconds: int) -> str:
    return f("refresh.wait_s", count=max(1, seconds)) if seconds < 60 else f("refresh.wait", count=-(-seconds // 60))


def sync_ctx(f: Fmt, status: dict) -> dict:
    busy = status["state"] in BUSY
    wait = (f(status["message"] or f"status.{status['state']}") if busy else f("status.failed") if status["state"] == "failed"
            else wait_text(f, status["next_refresh_in"]) if status["next_refresh_in"] > 0 else "")
    last = _ms(status.get("last"))
    return {"busy": busy, "pct": round(100 * (status.get("progress") or 0)), "wait": wait,
            "last": f("refresh.last", when=f.stamp(last)) if last else "", "disabled": busy or status["next_refresh_in"] > 0}


def publish_ctx(request: Request, f: Fmt, user: dict, status: dict) -> dict | None:
    s = request.app.state.settings
    if not can_publish(s, user):
        return None
    last = _ms(status.get("last"))
    fresh = last is not None and datetime.now(timezone.utc).timestamp() * 1000 - last < s.cooldown_s * 1000
    ready = status["state"] not in BUSY and fresh
    published = _ms(status.get("published"))
    note = f("publish.stale") if not fresh and status["state"] not in BUSY else f("publish.last", when=f.stamp(published)) if published else ""
    return {"ready": ready, "note": note}


def base_ctx(request: Request, user: dict, status: dict, f: Fmt) -> dict:
    s = request.app.state.settings
    return {"lang": f.lang, "t": f, "csrf": user["csrf"], "sync": sync_ctx(f, status), "publish": publish_ctx(request, f, user, status),
            "coalition_color": user.get("coalition_color") or "", "accent": user.get("coalition_color") or "", "issues_url": s.issues_url,
            "here": request.url.path + (f"?{request.url.query}" if request.url.query else ""), "pages": list(PAGES), "page": None, "key": "",
            "login": user["login"], "report_sig": "", "dev_mode": bool(s.dev_report)}


async def _kick(request: Request, store: Store, uid, status: dict) -> dict:
    """Nothing stored, nothing queued and the hour is over: start the extraction from here."""
    if status["state"] == "none" and status["next_refresh_in"] <= 0:
        return await enqueue_extraction(store, request.app.state.jobs, uid, request.app.state.limiter)
    return status


def _boot_ctx(f: Fmt, status: dict) -> dict:
    view = ("error" if status["state"] == "failed" else
            "wait" if status["next_refresh_in"] > 0 and status["state"] in ("none", "done") else "progress")
    return {"view": view, "pct": round(100 * (status.get("progress") or 0)), "wait": wait_text(f, status["next_refresh_in"]),
            "message": f(status["message"] or f"status.{status['state']}")}


async def dashboard(request: Request, key: str, user: dict):
    store = _store(request)
    status = await store.status(user["id"])
    if status["state"] == "refused":
        return RedirectResponse(f"/app/refused?reason={status['message'] or 'campus'}", status_code=303)
    f = Fmt(pick_lang(request))
    ctx = {**base_ctx(request, user, status, f), "key": key}
    if not await consent.is_current(store, user["id"]):
        return templates.TemplateResponse(request, "dash/consent.html", {**ctx, "title": f("privacy.title"), "version": consent.VERSION,
                                                                         "error": request.query_params.get("error") == "consent"}, headers=NO_STORE)
    data = await store.load_report(user["id"])
    if data is None and status["state"] not in BUSY and request.query_params.get("fresh") != "1":
        # the server's copy is gone (an hour unused, or a restart): the browser hands its own back, or asks for a fresh one
        return templates.TemplateResponse(request, "dash/restore.html", {**ctx, "title": f("boot.title")}, headers=NO_STORE)
    if data is None:
        status = await _kick(request, store, user["id"], status)
        return templates.TemplateResponse(request, "dash/boot.html", {**ctx, "boot": _boot_ctx(f, status), "title": f("boot.title")}, headers=NO_STORE)
    page = Page(f, data, key, {k: v for k, v in request.query_params.items() if k != "fresh"}, request.app.state.settings.optout_logins)
    ctx["report_sig"] = (await store.raw_report(user["id"]) or (b"", ""))[1]
    sections = BUILDERS[key](page)
    return templates.TemplateResponse(request, "dash/page.html", {
        **ctx, "key": key, "page": page, "sections": sections, "head": page.head(), "foot": page.footer(), "title": f(f"pages.{key}")}, headers=NO_STORE)


def _route(key: str):
    async def view(request: Request, user: dict = Depends(current_user)):
        return await dashboard(request, key, user)
    return view


for _key, _path in PAGES.items():
    router.add_api_route(_path, _route(_key), methods=["GET"], response_class=HTMLResponse)


@router.get("/app/corrections")
async def old_corrections(request: Request):
    return RedirectResponse("/app/evaluations", status_code=301)


@router.get("/app/sync")
async def sync(request: Request, user: dict = Depends(current_user)):
    """The top bar's sync state, polled while an extraction runs; the page reloads once it is over."""
    store = _store(request)
    status = await store.status(user["id"])
    if status["state"] == "refused":
        return Response(headers={"HX-Redirect": f"/app/refused?reason={status['message'] or 'campus'}"})
    f = Fmt(pick_lang(request))
    headers = {**NO_STORE, **({} if status["state"] in BUSY else {"HX-Refresh": "true"})}
    return templates.TemplateResponse(request, "dash/_sync.html", base_ctx(request, user, status, f), headers=headers)


@router.get("/app/boot")
async def boot(request: Request, user: dict = Depends(current_user)):
    """The first-visit screen's state, polled until the report exists."""
    store = _store(request)
    status = await store.status(user["id"])
    if status["state"] == "refused":
        return Response(headers={"HX-Redirect": f"/app/refused?reason={status['message'] or 'campus'}"})
    if await store.load_report(user["id"]) is not None:
        return Response(headers={"HX-Refresh": "true"})
    status = await _kick(request, store, user["id"], status)
    f = Fmt(pick_lang(request))
    return templates.TemplateResponse(request, "dash/_boot.html", {**base_ctx(request, user, status, f), "boot": _boot_ctx(f, status)}, headers=NO_STORE)


@router.post("/app/refresh")
async def refresh(request: Request, user: dict = Depends(current_user)):
    if not await csrf_ok(request, user):
        return Response(status_code=403)
    store = _store(request)
    status = await enqueue_extraction(store, request.app.state.jobs, user["id"], request.app.state.limiter)
    if request.headers.get("hx-request"):
        f = Fmt(pick_lang(request))
        return templates.TemplateResponse(request, "dash/_sync.html", base_ctx(request, user, status, f), headers=NO_STORE)
    return RedirectResponse(safe_next((await request.form()).get("next", "/app")), status_code=303)


@router.get("/app/report.json")
async def report_copy(request: Request, user: dict = Depends(current_user)):
    """The report for the browser to keep, with the signature it must show to hand it back."""
    found = await _store(request).raw_report(user["id"])
    if found is None:
        return Response(status_code=404)
    return Response(found[0], media_type="application/json", headers={"X-Report-Sig": found[1], **NO_STORE})


MAX_REPORT = 16 * 1024 * 1024


@router.post("/app/report")
async def report_back(request: Request, user: dict = Depends(current_user)):
    """The browser returns its copy; only the exact bytes this server signed for this user are taken."""
    if not await csrf_ok(request, user):
        return Response(status_code=403)
    raw = await request.body()
    store = _store(request)
    sig = request.headers.get("x-report-sig", "")
    if not raw or len(raw) > MAX_REPORT or not hmac.compare_digest(sig, store.sign(user["id"], raw)):
        return Response(status_code=400)
    await store.save_raw(user["id"], raw)
    return Response(status_code=204)


@router.get("/app/projects.csv")
async def csv_export(request: Request, user: dict = Depends(current_user)):
    data = await _store(request).load_report(user["id"])
    if data is None:
        return Response(status_code=404)
    page = Page(Fmt(pick_lang(request)), data, "projects", dict(request.query_params), request.app.state.settings.optout_logins)
    return Response(projects_csv(page), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="projects-{page.q("track", "student", ("student", "piscine", "all"))}.csv"', **NO_STORE})


@router.get("/app/portfolio.csv")
async def portfolio_export(request: Request, user: dict = Depends(current_user)):
    data = await _store(request).load_report(user["id"])
    if data is None:
        return Response(status_code=404)
    page = Page(Fmt(pick_lang(request)), data, "projects", {}, request.app.state.settings.optout_logins)
    return Response(portfolio_csv(page), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="portfolio-{user["login"]}.csv"', **NO_STORE})


async def _confirm(request: Request, user: dict, kind: str, result: dict | None = None):
    status = await _store(request).status(user["id"])
    f = Fmt(pick_lang(request))
    return templates.TemplateResponse(request, "dash/confirm.html", {**base_ctx(request, user, status, f), "kind": kind, "result": result,
                                                                     "title": f(f"{kind}.title")}, headers=NO_STORE)


@router.get("/app/delete")
async def delete_confirm(request: Request, user: dict = Depends(current_user)):
    return await _confirm(request, user, "delete")


@router.post("/app/delete")
async def delete(request: Request, user: dict = Depends(current_user)):
    if not await csrf_ok(request, user):
        return Response(status_code=403)
    await delete_everything(_store(request), request.app.state.jobs, user["id"])
    await SessionStore(request.app.state.memory, request.app.state.settings).delete(request.state.sid)
    response = RedirectResponse("/", status_code=303, headers={"Clear-Site-Data": '"storage"'})  # the browser's copy goes too
    response.delete_cookie(COOKIE, path="/", secure=request.app.state.settings.secure_cookies, httponly=True, samesite="lax")
    return response


@router.get("/app/publish")
async def publish_confirm(request: Request, user: dict = Depends(current_user)):
    if not can_publish(request.app.state.settings, user):
        return RedirectResponse("/app", status_code=303)
    return await _confirm(request, user, "publish")


@router.post("/app/publish")
async def publish(request: Request, user: dict = Depends(current_user)):
    if not await csrf_ok(request, user):
        return Response(status_code=403)
    code, payload = await run_publish(request, user)
    return await _confirm(request, user, "publish", {"ok": code == 200, **payload})


@router.get("/app/consent")
async def consent_page(request: Request, user: dict = Depends(current_user)):
    return await dashboard(request, "home", user)


@router.post("/app/consent")
async def accept(request: Request, user: dict = Depends(current_user)):
    """Accepting the current policy while signed in (after it changed)."""
    if not await csrf_ok(request, user):
        return Response(status_code=403)
    form = await request.form()
    target = safe_next(form.get("next", "/app"))
    if form.get("accept") != "1":
        return RedirectResponse("/app/consent?error=consent", status_code=303)
    await consent.record(_store(request), user["id"])
    return RedirectResponse(target, status_code=303)
