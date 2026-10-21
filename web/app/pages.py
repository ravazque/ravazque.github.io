"""Public pages rendered on the server: landing, About, Privacy, the refused page and the language switch."""
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

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
    if u.scheme or u.netloc or u.path not in SAFE_NEXT:
        return "/"
    return u.path + (f"?{u.query}" if u.query else "")


@router.get("/")
async def landing(request: Request, error: str = ""):
    if await SessionStore(request.app.state.redis, request.app.state.settings).get(request.cookies.get(COOKIE)):
        return RedirectResponse("/app", status_code=303)
    return render(request, "landing.html", error=error if error in ("signin", "consent") else "")


@router.get("/about")
async def about(request: Request):
    return render(request, "about.html", page="about", heading=strings(pick_lang(request))["about.title"])


@router.get("/privacy")
async def privacy(request: Request):
    return render(request, "privacy.html", page="privacy", heading=strings(pick_lang(request))["privacy.title"])


@router.post("/lang")
async def set_lang(request: Request, lang: str = Form(""), next: str = Form("/")):
    response = RedirectResponse(safe_next(next), status_code=303)
    if lang in LANGS:
        response.set_cookie("lang", lang, max_age=31_536_000, path="/", secure=request.app.state.settings.secure_cookies, samesite="lax")
    return response


@router.get("/app/refused")
async def refused(request: Request, reason: str = ""):
    return render(request, "refused.html", reason=reason if reason in REASONS else "unknown")
