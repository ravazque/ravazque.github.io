"""HTML pages rendered on the server (public pages, the refused page, the dashboard shell)."""
from pathlib import Path

from html import escape

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from .i18n import LANGS, pick_lang, strings
from .publish import can_publish
from core42 import FRONTEND_DIR

from .sessions import COOKIE, SessionStore, current_user
from .store import Store

templates = Jinja2Templates(directory=Path(__file__).resolve().parent / "templates")
router = APIRouter()
REASONS = {"staff", "piscine", "blackholed", "frozen", "campus"}
SAFE_NEXT = {"/", "/about", "/privacy", "/app", "/app/corrections", "/app/campus"}


def render(request: Request, name: str, **ctx):
    lang = pick_lang(request)
    return templates.TemplateResponse(request, name, {"lang": lang, "t": strings(lang), "email": request.app.state.settings.contact_email,
                                                      "issues_url": request.app.state.settings.issues_url,
                                                      "next_path": request.url.path, **ctx})


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
    response = RedirectResponse(next if next in SAFE_NEXT else "/", status_code=303)
    if lang in LANGS:
        response.set_cookie("lang", lang, max_age=31_536_000, path="/", secure=request.app.state.settings.secure_cookies, samesite="lax")
    return response


@router.get("/app/refused")
async def refused(request: Request, reason: str = ""):
    return render(request, "refused.html", reason=reason if reason in REASONS else "unknown")


# Dashboard pages: the shared report.html with linked assets
DASHBOARD = {"/app": ("web-home", "home"), "/app/corrections": ("web-corrections", "corrections"), "/app/campus": ("web-campus", "campus")}
HEAD = ('<script src="/shared/theme.js"></script><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="icon" href="/static/favicon-32.png" sizes="32x32" type="image/png">'
        '<link rel="apple-touch-icon" href="/static/apple-touch-icon.png">'
        '<link rel="stylesheet" href="/shared/vendor/fonts.css"><link rel="stylesheet" href="/ui.css">'
        '<link rel="stylesheet" href="/shared/controls.css"><link rel="stylesheet" href="/shared/report.css">')
BODY_END = ('<script src="/shared/vendor/chart.umd.min.js"></script><script src="/shared/controls.js"></script>'
            '<script src="/shared/accent.js"></script><script src="/shared/radar.js"></script><script src="/shared/projects.js"></script><script src="/static/vendor/d3.min.js"></script>'
            '<script src="/static/graph.js"></script><script src="/static/network.js"></script>'
            '<script src="/shared/report.js"></script><script src="/static/app.js"></script>')


def _foot_links(t: dict, issues_url: str) -> str:
    issues = f'<a href="{escape(issues_url)}" rel="noopener" target="_blank">{escape(t["site.issues"])}</a>' if issues_url else ""
    return (f'<nav class="foot-links"><a href="/about">{escape(t["site.about"])}</a>'
            f'<a href="/privacy">{escape(t["site.privacy"])}</a>{issues}</nav>')


def _dashboard(page_kind: str, key: str):
    async def view(request: Request, user: dict = Depends(current_user)):
        status = await Store(request.app.state.redis, request.app.state.settings).status(user["id"])
        if status["state"] == "refused":
            return RedirectResponse(f"/app/refused?reason={status['message'] or 'campus'}", status_code=303)
        lang = pick_lang(request)
        publish = ' data-publish="1"' if can_publish(request.app.state.settings, user) else ""
        attrs = (f'<body data-page="{page_kind}" data-csrf="{escape(user["csrf"])}" data-lang="{lang}"'
                 f' data-accent="{escape(user.get("coalition_color") or "")}"{publish}>')
        html = (FRONTEND_DIR / "report.html").read_text()
        html = (html.replace("{{TITLE}}", f'{escape(strings(lang)[f"pages.{key}"])} · ravazque.top', 1)
                .replace("{{HEAD}}", HEAD, 1).replace("{{BODY_END}}", BODY_END, 1).replace("<body>", attrs, 1)
                .replace("{{FOOT_LINKS}}", _foot_links(strings(lang), request.app.state.settings.issues_url), 1)
                .replace('<html lang="en">', f'<html lang="{lang}">', 1))
        return HTMLResponse(html, headers={"Cache-Control": "no-store"})
    return view


for _path, (_kind, _key) in DASHBOARD.items():
    router.add_api_route(_path, _dashboard(_kind, _key), methods=["GET"])
