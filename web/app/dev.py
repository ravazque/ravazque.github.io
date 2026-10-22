"""make dev: the last saved report (web/preview/data.json, refreshed by make build) is in memory from the start and
/dev/login signs in as its owner, so no 42 sign-in and no extraction are needed. Settings.check() refuses it anywhere
but https://localhost."""
import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse, Response

from . import consent
from .sessions import SessionStore, set_session_cookie
from .store import Store

router = APIRouter()


async def seed(app):
    s = app.state.settings
    path = Path(s.dev_report)
    app.state.dev_login = None
    if not path.exists() or not s.dev_uid:
        return
    data = json.loads(path.read_text())
    store = Store(app.state.memory, s)
    await store.save_report(s.dev_uid, data)
    saved = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
    await store.set_status(s.dev_uid, state="done", progress=1, message="", last=saved)
    profile = data["periods"]["all"]["profile"]
    app.state.dev_login = {"id": s.dev_uid, "login": profile["login"], "name": profile.get("name"), "image": None,
                           "coalition_color": (profile.get("coalition") or {}).get("color")}


@router.get("/dev/login")
async def dev_login(request: Request):
    user = getattr(request.app.state, "dev_login", None)
    if not user:
        return Response(status_code=404)
    s = request.app.state.settings
    sid = await SessionStore(request.app.state.memory, s).create(user)
    await consent.record(Store(request.app.state.memory, s), user["id"])
    response = RedirectResponse("/app", status_code=303)
    set_session_cookie(response, sid, s)
    return response
