"""make dev: the last saved report (web/preview/data.json, refreshed by make build) is in memory from the start and
/dev/login signs in as its owner, so no 42 sign-in and no extraction are needed. Settings.check() refuses it anywhere
but https://localhost."""
import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Query, Request
from fastapi.responses import RedirectResponse, Response

from . import consent
from .sessions import SessionStore, set_session_cookie
from .store import Store

router = APIRouter()


async def seed(app):
    """The saved report of DEV_UID, and the synthetic test profiles (preview/test-*.json, written by
    scripts/test_profiles.py) beside it; each gets a sign-in link on the landing."""
    s = app.state.settings
    app.state.dev_logins = {}
    if not s.dev_report:
        return
    path = Path(s.dev_report)
    store = Store(app.state.memory, s)
    reports = [(s.dev_uid, path)] if path.exists() and s.dev_uid else []
    for test in sorted(path.parent.glob("test-*.json")):
        reports.append((None, test))
    for uid, file in reports:
        data = json.loads(file.read_text())
        uid = uid or data.get("test_profile")
        if type(uid) is not int or uid <= 0:  # a test profile carries its own synthetic id
            continue
        await store.save_report(uid, data)
        saved = datetime.fromtimestamp(file.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
        await store.set_status(uid, state="done", progress=1, message="", last=saved)
        profile = data["periods"]["all"]["profile"]
        app.state.dev_logins[profile["login"]] = {"id": uid, "login": profile["login"], "name": profile.get("name"), "image": None,
                                                  "coalition_color": (profile.get("coalition") or {}).get("color"),
                                                  "test": bool(data.get("test_profile"))}


@router.get("/dev/login")
async def dev_login(request: Request, as_: str | None = Query(None, alias="as")):
    logins = getattr(request.app.state, "dev_logins", {})
    user = logins.get(as_) if as_ else next((u for u in logins.values() if not u["test"]), None)
    if not user:
        return Response(status_code=404)
    user = {k: v for k, v in user.items() if k != "test"}
    s = request.app.state.settings
    sid = await SessionStore(request.app.state.memory, s).create(user)
    await consent.record(Store(request.app.state.memory, s), user["id"])
    response = RedirectResponse("/app", status_code=303)
    set_session_cookie(response, sid, s)
    return response
