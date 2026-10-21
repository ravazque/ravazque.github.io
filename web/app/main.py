"""App factory: routes are mounted here; state (settings, redis, clients) lives on app.state."""
from pathlib import Path

from contextlib import asynccontextmanager

import httpx
from arq import create_pool
from arq.connections import RedisSettings
from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from core42 import FRONTEND_DIR
from core42.ui import UI_FILE, css_from_ui, load_ui

from . import auth, pages, routes_api
from .api42 import Api42
from .limiter import RateLimiter
from .redis import make_redis
from .sessions import NoSession, no_session_handler
from .settings import Settings
from .store import first_extraction

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


def create_app(settings: Settings, redis, http: httpx.AsyncClient | None = None, arq=None) -> FastAPI:
    http = http or httpx.AsyncClient()

    @asynccontextmanager
    async def lifespan(app_):
        if app_.state.arq is None:
            app_.state.arq = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        yield
        await http.aclose()

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.settings, app.state.redis, app.state.http = settings, redis, http
    app.state.limiter = RateLimiter(redis)
    app.state.api = Api42(settings, redis, http, app.state.limiter)
    app.state.arq = arq
    app.state.on_signed_in = first_extraction
    app.add_exception_handler(NoSession, no_session_handler)
    app.include_router(auth.router)
    app.include_router(pages.router)
    app.include_router(routes_api.router)
    ui_css = UiCss()

    @app.get("/healthz")
    async def healthz():
        await redis.ping()
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
    return create_app(settings, make_redis(settings.redis_url))
