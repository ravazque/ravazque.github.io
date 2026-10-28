"""Public pages rendered on the server: landing, About, Privacy, the refused page and the language switch."""
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from . import consent
from .dash.views import PAGES
from .i18n import LANGS, pick_lang, strings
from .sessions import COOKIE, SessionStore

templates = Jinja2Templates(directory=Path(__file__).resolve().parent / "templates")
router = APIRouter()
REASONS = {"staff", "piscine", "blackholed", "frozen", "campus"}
SAFE_NEXT = {"/", "/about", "/privacy", *PAGES.values()}


def render(request: Request, name: str, **ctx):
    lang = pick_lang(request)
    return templates.TemplateResponse(request, name, {"lang": lang, "t": strings(lang), "email": request.app.state.settings.contact_email,
                                                      "issues_url": request.app.state.settings.issues_url,
                                                      "next_path": request.url.path, **ctx})


def safe_next(target: str) -> str:
    """A path of this site (its query kept) or "/": never another host."""
    u = urlsplit(target)
    # the path handed back is this site's own constant, never the request's text; the query only follows a "?"
    path = next((p for p in SAFE_NEXT if p == u.path), None)
    if u.scheme or u.netloc or path is None:
        return "/"
    return f"{path}?{urlencode(parse_qsl(u.query))}" if u.query else path


def back_to(request: Request) -> str:
    """Where the reading pages' Back button leads: the page of this site you came from, otherwise the landing."""
    ref = urlsplit(request.headers.get("referer", ""))
    if ref.netloc != request.url.netloc or ref.path in ("/about", "/privacy") or not (ref.path in SAFE_NEXT or ref.path.startswith("/app")):
        return "/"
    return ref.path + (f"?{ref.query}" if ref.query else "")


@router.get("/")
async def landing(request: Request, error: str = ""):
    if await SessionStore(request.app.state.memory, request.app.state.settings).get(request.cookies.get(COOKIE)):
        return RedirectResponse("/app", status_code=303)
    dev = [{"label": ("Test · " if u["test"] else "Dev · ") + u["login"], "href": f"/dev/login?as={u['login']}" if u["test"] else "/dev/login"}
           for u in getattr(request.app.state, "dev_logins", {}).values()]
    return render(request, "landing.html", error=error if error in ("signin", "consent") else "", dev=dev)


@router.get("/about")
async def about(request: Request):
    return render(request, "about.html", page="about", heading=strings(pick_lang(request))["about.title"], back=back_to(request))


@router.get("/privacy")
async def privacy(request: Request):
    return render(request, "privacy.html", page="privacy", heading=strings(pick_lang(request))["privacy.title"], back=back_to(request),
                  controller=request.app.state.settings.controller_name, version=consent.VERSION, updated=consent.UPDATED)


@router.post("/lang")
async def set_lang(request: Request, lang: str = Form(""), next: str = Form("/")):
    response = RedirectResponse(safe_next(next), status_code=303)
    if (chosen := {code: code for code in LANGS}.get(lang)):  # the cookie holds our constant, not the form's text
        response.set_cookie("lang", chosen, max_age=31_536_000, path="/", secure=request.app.state.settings.secure_cookies, samesite="lax")
    return response


@router.get("/app/refused")
async def refused(request: Request, reason: str = ""):
    return render(request, "refused.html", reason=reason if reason in REASONS else "unknown")
