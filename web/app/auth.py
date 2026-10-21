"""42 OAuth (authorization code). The user's token only proves who they are; it is never stored."""
import secrets
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse, RedirectResponse

from core42.profile import access, main_coalition

from .api42 import API, Api42Error
from .sessions import COOKIE, SessionStore, csrf_ok, current_user, set_session_cookie
from .store import Store

STATE_COOKIE = "__Host-oauth_state"
CALLBACKS_PER_WINDOW, CALLBACK_WINDOW_S = 10, 600  # each callback spends shared API budget, so cap it per address
CALLBACK_KEY = "rl:signin:{}"
router = APIRouter()


def _clear(response, name: str, settings):
    # browsers only accept the deletion of a __Host- cookie when it carries the same Secure and Path attributes
    response.delete_cookie(name, path="/", secure=settings.secure_cookies, httponly=True, samesite="lax")


@router.get("/auth/login")
async def login(request: Request, accept: str = ""):
    if accept != "1":
        return RedirectResponse("/?error=consent", status_code=303)
    s = request.app.state.settings
    state = secrets.token_urlsafe(24)
    query = urlencode({"client_id": s.ft_uid, "redirect_uri": f"{s.base_url}/auth/callback", "response_type": "code",
                       "scope": "public", "state": state})
    response = RedirectResponse(f"{API}/oauth/authorize?{query}", status_code=307)
    response.set_cookie(STATE_COOKIE, state, max_age=600, path="/", secure=s.secure_cookies, httponly=True, samesite="lax")
    return response


@router.get("/auth/callback")
async def callback(request: Request, code: str = "", state: str = ""):
    expected = request.cookies.get(STATE_COOKIE)
    if not code or not state or not expected or not secrets.compare_digest(state, expected):
        return PlainTextResponse("Invalid sign-in state. Please start again.", status_code=400)
    app, s = request.app, request.app.state.settings
    api = app.state.api
    key = CALLBACK_KEY.format(Store(app.state.redis, s)._digest(request.client.host if request.client else ""))
    if (attempts := await app.state.redis.incr(key)) == 1:
        await app.state.redis.expire(key, CALLBACK_WINDOW_S)
    if attempts > CALLBACKS_PER_WINDOW:
        return PlainTextResponse("Too many sign-in attempts. Try again in a few minutes.", status_code=429)
    try:
        token = await api.exchange_code(code)
        me = await api.me(token)
    except (Api42Error, httpx.HTTPError):
        return RedirectResponse("/?error=signin", status_code=303)
    allowed, reason = access(me, datetime.now(timezone.utc))
    if not allowed:
        response = RedirectResponse(f"/app/refused?reason={reason}", status_code=303)
        _clear(response, STATE_COOKIE, s)
        return response
    try:
        coalition = main_coalition(await api.get(f"/v2/users/{me['id']}/coalitions"))
    except (Api42Error, httpx.HTTPError):  # the accent falls back to the default; sign-in goes on
        coalition = None
    image = ((me.get("image") or {}).get("versions") or {}).get("medium") or (me.get("image") or {}).get("link")
    sid = await SessionStore(app.state.redis, s).create({"id": me["id"], "login": me["login"], "name": me.get("displayname"),
                                                         "image": image, "coalition_color": (coalition or {}).get("color")})
    store = Store(app.state.redis, s)
    await store.clear_refusal(me["id"])
    await store.set_status(me["id"], privacy_accepted=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    await app.state.on_signed_in(app, me["id"], me)
    response = RedirectResponse("/app", status_code=303)
    _clear(response, STATE_COOKIE, s)
    set_session_cookie(response, sid, s)
    return response


@router.post("/auth/logout")
async def logout(request: Request, user: dict = Depends(current_user)):
    if not await csrf_ok(request, user):
        return PlainTextResponse("Invalid request token.", status_code=403)
    await SessionStore(request.app.state.redis, request.app.state.settings).delete(request.state.sid)
    response = RedirectResponse("/", status_code=303)
    _clear(response, COOKIE, request.app.state.settings)
    return response

