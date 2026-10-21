"""JSON API of the dashboard and the signed-in user's photo. Every route needs a session."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from .api42 import Api42Error
from .publish import PublishError, can_publish, is_fresh, publish_snapshot, snapshot
from .sessions import COOKIE, SessionStore, csrf_ok, current_user
from .store import Store, enqueue_extraction

router = APIRouter()


def _store(request: Request) -> Store:
    return Store(request.app.state.redis, request.app.state.settings)


@router.get("/api/me/report")
async def report(request: Request, user: dict = Depends(current_user)):
    data = await _store(request).load_report(user["id"])
    return JSONResponse(data) if data is not None else JSONResponse({"error": "no-data"}, status_code=404)


@router.get("/api/me/status")
async def status(request: Request, user: dict = Depends(current_user)):
    return await _store(request).status(user["id"])


@router.post("/api/me/refresh")
async def refresh(request: Request, user: dict = Depends(current_user)):
    if not await csrf_ok(request, user):
        return JSONResponse({"error": "csrf"}, status_code=403)
    store = _store(request)
    s = await enqueue_extraction(store, request.app.state.arq, user["id"], request.app.state.limiter)
    if s["state"] not in ("queued", "running") and s["next_refresh_in"] > 0:
        return JSONResponse(s, status_code=429)
    return JSONResponse(s, status_code=202)


@router.post("/api/me/delete")
async def delete(request: Request, user: dict = Depends(current_user)):
    if not await csrf_ok(request, user):
        return JSONResponse({"error": "csrf"}, status_code=403)
    await _store(request).delete_user(user["id"])
    await SessionStore(request.app.state.redis, request.app.state.settings).delete(request.state.sid)
    response = Response(status_code=204)
    response.delete_cookie(COOKIE, path="/", secure=True, httponly=True, samesite="lax")
    return response


@router.post("/api/me/publish")
async def publish(request: Request, user: dict = Depends(current_user)):
    """The owner commits the public snapshot of their own, freshly extracted profile to the GitHub Pages site."""
    if not await csrf_ok(request, user):
        return JSONResponse({"error": "csrf"}, status_code=403)
    settings = request.app.state.settings
    if not settings.owner_login or user.get("login") != settings.owner_login:
        return JSONResponse({"error": "owner"}, status_code=403)
    if not can_publish(settings, user):
        return JSONResponse({"error": "publish-off"}, status_code=503)
    store = _store(request)
    last = (await store.status(user["id"])).get("last")
    data = await store.load_report(user["id"])
    if data is None or not is_fresh(last, datetime.now(timezone.utc), settings.cooldown_s):
        return JSONResponse({"error": "stale"}, status_code=409)
    redis = request.app.state.redis
    if not await redis.set("lock:publish", 1, nx=True, ex=60):
        return JSONResponse({"error": "busy"}, status_code=409)
    try:
        url = await publish_snapshot(request.app.state.http, settings, snapshot(data, last))
    except PublishError:
        return JSONResponse({"error": "github"}, status_code=502)
    finally:
        await redis.delete("lock:publish")
    published = datetime.now(timezone.utc).isoformat(timespec="seconds")
    await store.set_status(user["id"], published=published)
    return {"url": url, "published": published}


@router.get("/avatar/me")
async def avatar(request: Request, user: dict = Depends(current_user)):
    if not user.get("image"):
        return Response(status_code=404)
    try:
        content, media_type = await request.app.state.api.avatar(user["image"])
    except Api42Error:
        return Response(status_code=404)
    return Response(content, media_type=media_type, headers={"Cache-Control": "private, max-age=86400"})
