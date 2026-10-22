"""App factory: routes are mounted here; state (settings, memory, clients, jobs) lives on app.state."""
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from core42 import FRONTEND_DIR
from core42.ui import UI_FILE, css_from_ui, load_ui

from . import auth, consent, pages, routes_api, routes_dash
from .api42 import Api42
from .jobs import Jobs
from .limiter import RateLimiter
from .memory import Memory
from .sessions import NoSession, no_session_handler
from .settings import Settings
from .store import Store, first_extraction
from .worker import extract_job

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


class UiCss:
    """ui.json → CSS, regenerated when the file changes so edits show on the next reload."""

    def __init__(self, path: Path = UI_FILE):
        self.path, self.mtime, self.css = path, None, ""

    def get(self) -> str:
        mtime = self.path.stat().st_mtime
        if mtime != self.mtime:
            self.css, self.mtime = css_from_ui(load_ui(self.path)), mtime
        return self.css


def create_app(settings: Settings, memory: Memory, http: httpx.AsyncClient | None = None, jobs=None) -> FastAPI:
    http = http or httpx.AsyncClient()

    async def sweep():
        while True:
            await asyncio.sleep(60)
            memory.sweep()

    @asynccontextmanager
    async def lifespan(_app):
        await consent.load(memory, settings)
        sweeper = asyncio.create_task(sweep())
        yield
        sweeper.cancel()
        if isinstance(app.state.jobs, Jobs):
            await app.state.jobs.stop()
        await http.aclose()

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.settings, app.state.memory, app.state.http = settings, memory, http
    app.state.limiter = RateLimiter(memory)
    app.state.api = Api42(settings, memory, http, app.state.limiter)
    ctx = {"store": Store(memory, settings), "api": app.state.api}
    app.state.jobs = jobs or Jobs(lambda uid: extract_job(ctx, uid))
    app.state.on_signed_in = first_extraction
    app.add_exception_handler(NoSession, no_session_handler)
    app.include_router(auth.router)
    app.include_router(pages.router)
    app.include_router(routes_api.router)
    app.include_router(routes_dash.router)
    ui_css = UiCss()

    @app.get("/healthz")
    async def healthz():
        await memory.ping()
        return JSONResponse({"ok": True})

    @app.get("/ui.css")
    async def ui():
        return Response(ui_css.get(), media_type="text/css", headers={"Cache-Control": "no-cache"})

    app.mount("/shared", StaticFiles(directory=FRONTEND_DIR), name="shared")
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


def build() -> FastAPI:
    """Entry point for uvicorn --factory."""
    settings = Settings.from_env().check()
    return create_app(settings, Memory())
