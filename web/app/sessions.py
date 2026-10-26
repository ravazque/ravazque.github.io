"""Server-side sessions in Redis. The browser only holds a random id in the __Host-session cookie."""
import json
import secrets

from fastapi import Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

COOKIE = "__Host-session"
KEY = "sess:{}"


class SessionStore:
    def __init__(self, memory, settings):
        self.memory, self.settings = memory, settings

    async def create(self, user: dict) -> str:
        sid = secrets.token_urlsafe(32)
        data = {"id": user["id"], "login": user["login"], "name": user.get("name"), "image": user.get("image"),
                "coalition_color": user.get("coalition_color"), "csrf": secrets.token_urlsafe(32)}
        await self.memory.set(KEY.format(sid), json.dumps(data), ex=self.settings.session_s)
        return sid

    async def get(self, sid: str | None) -> dict | None:
        if not sid:
            return None
        raw = await self.memory.get(KEY.format(sid))
        if raw is None:
            return None
        await self.memory.expire(KEY.format(sid), self.settings.session_s)  # sliding
        return json.loads(raw)

    async def delete(self, sid: str | None):
        if sid:
            await self.memory.delete(KEY.format(sid))


class NoSession(Exception):
    """Raised by current_user; turned into a redirect for pages and 401 JSON for /api."""


async def current_user(request: Request) -> dict:
    store = SessionStore(request.app.state.memory, request.app.state.settings)
    user = await store.get(request.cookies.get(COOKIE))
    if user is None:
        raise NoSession()
    request.state.sid = request.cookies.get(COOKIE)
    return user


async def no_session_handler(request: Request, _exc: NoSession):
    if request.url.path.startswith("/api/") or request.url.path.startswith("/avatar/"):
        return JSONResponse({"error": "session"}, status_code=401)
    if request.headers.get("HX-Request"):  # htmx would follow a 303 and swap the landing into a section: go there whole
        return Response(headers={"HX-Redirect": "/"})
    return RedirectResponse("/", status_code=303)


def set_session_cookie(response, sid: str, settings):
    response.set_cookie(COOKIE, sid, max_age=settings.session_s, path="/", secure=settings.secure_cookies, httponly=True, samesite="lax")


async def csrf_ok(request: Request, user: dict) -> bool:
    sent = request.headers.get("x-csrf-token")
    if sent is None and request.headers.get("content-type", "").startswith("application/x-www-form-urlencoded"):
        sent = (await request.form()).get("csrf")
    return bool(sent) and secrets.compare_digest(str(sent), user["csrf"])
