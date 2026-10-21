"""The dashboard: five pages rendered on the server, the boot screen, the sync bar and the account actions."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from .dash.fmt import Fmt
from .dash.views import BUILDERS, PAGES, Page, projects_csv
from .i18n import pick_lang
from .pages import safe_next, templates
from .publish import can_publish
from .routes_api import run_publish
from .sessions import COOKIE, SessionStore, csrf_ok, current_user
from .store import Store, enqueue_extraction

router = APIRouter()
BUSY = ("queued", "running")
NO_STORE = {"Cache-Control": "no-store"}


def _store(request: Request) -> Store:
    return Store(request.app.state.redis, request.app.state.settings)


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
            "here": request.url.path + (f"?{request.url.query}" if request.url.query else ""), "pages": list(PAGES), "page": None, "key": ""}


async def _kick(request: Request, store: Store, uid, status: dict) -> dict:
    """Nothing stored, nothing queued and the hour is over: start the extraction from here."""
    if status["state"] == "none" and status["next_refresh_in"] <= 0:
        return await enqueue_extraction(store, request.app.state.arq, uid, request.app.state.limiter)
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
    data = await store.load_report(user["id"])
    if data is None:
        status = await _kick(request, store, user["id"], status)
        return templates.TemplateResponse(request, "dash/boot.html", {**ctx, "boot": _boot_ctx(f, status), "title": f("boot.title")}, headers=NO_STORE)
    page = Page(f, data, key, dict(request.query_params))
    sections = BUILDERS[key](page)
    return templates.TemplateResponse(request, "dash/page.html", {
        **ctx, "key": key, "page": page, "sections": sections, "rail": page.rail(), "foot": page.footer(), "title": f(f"pages.{key}")}, headers=NO_STORE)


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
    status = await enqueue_extraction(store, request.app.state.arq, user["id"], request.app.state.limiter)
    if request.headers.get("hx-request"):
        f = Fmt(pick_lang(request))
        return templates.TemplateResponse(request, "dash/_sync.html", base_ctx(request, user, status, f), headers=NO_STORE)
    return RedirectResponse(safe_next((await request.form()).get("next", "/app")), status_code=303)


@router.get("/app/projects.csv")
async def csv_export(request: Request, user: dict = Depends(current_user)):
    data = await _store(request).load_report(user["id"])
    if data is None:
        return Response(status_code=404)
    page = Page(Fmt(pick_lang(request)), data, "projects", dict(request.query_params))
    return Response(projects_csv(page), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="projects-{page.q("track", "student", ("student", "piscine", "all"))}.csv"', **NO_STORE})


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
    await _store(request).delete_user(user["id"])
    await SessionStore(request.app.state.redis, request.app.state.settings).delete(request.state.sid)
    response = RedirectResponse("/", status_code=303)
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
