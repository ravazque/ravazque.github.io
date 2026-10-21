import httpx
import pytest
import respx

from app.store import Store


@pytest.fixture
def store(redis, settings):
    return Store(redis, settings)


async def test_api_without_session_is_401_json(client):
    for path in ("/api/me/status", "/api/me/report", "/avatar/me"):
        r = await client.get(path)
        assert r.status_code == 401 and r.json() == {"error": "session"}


async def test_expired_session_is_401_json(signed_in, redis):
    for key in await redis.keys("sess:*"):
        await redis.delete(key)
    r = await signed_in.get("/api/me/status")
    assert r.status_code == 401 and r.json() == {"error": "session"}


async def test_report_404_until_extracted(signed_in, store):
    r = await signed_in.get("/api/me/report")
    assert r.status_code == 404 and r.json() == {"error": "no-data"}
    await store.save_report(7, {"page": "web"})
    assert (await signed_in.get("/api/me/report")).json() == {"page": "web"}


async def test_status_reports_state_and_wait(signed_in, store):
    await store.set_status(7, state="running", progress=0.5)
    s = (await signed_in.get("/api/me/status")).json()
    assert s["state"] == "running" and s["progress"] == 0.5 and s["next_refresh_in"] == 0


async def test_refresh_requires_csrf(signed_in):
    assert (await signed_in.post("/api/me/refresh")).status_code == 403
    assert (await signed_in.post("/api/me/refresh", headers={"X-CSRF-Token": "wrong"})).status_code == 403


async def test_refresh_enqueues_once(signed_in, arq_pool):
    r = await signed_in.post("/api/me/refresh", headers=signed_in.csrf)
    assert r.status_code == 202 and r.json()["state"] == "queued"
    r = await signed_in.post("/api/me/refresh", headers=signed_in.csrf)
    assert r.status_code == 202 and arq_pool.enqueued == ["extract_job"]


async def test_refresh_in_cooldown_is_429_with_wait(signed_in, store):
    await store.start_cooldown(7)
    r = await signed_in.post("/api/me/refresh", headers=signed_in.csrf)
    assert r.status_code == 429 and 0 < r.json()["next_refresh_in"] <= 3600


async def test_delete_ends_session_and_data(signed_in, store):
    await store.save_report(7, {"x": 1})
    r = await signed_in.post("/api/me/delete", headers=signed_in.csrf)
    assert r.status_code == 204 and await store.load_report(7) is None
    assert "__Host-session" in r.headers["set-cookie"] and "Max-Age=0" in r.headers["set-cookie"]
    assert (await signed_in.get("/api/me/status")).status_code == 401


async def test_avatar_is_private_cache(signed_in):
    with respx.mock(assert_all_called=False) as router:
        router.route(host="localhost").pass_through()
        router.post("https://api.intra.42.fr/oauth/token").respond(json={"access_token": "APP", "expires_in": 7200})
        router.get("https://cdn.intra.42.fr/users/a/medium_ana.jpg").respond(content=b"JPEG", headers={"content-type": "image/jpeg"})
        r = await signed_in.get("/avatar/me")
    assert r.status_code == 200 and r.content == b"JPEG"
    assert r.headers["cache-control"] == "private, max-age=86400"


async def test_avatar_failure_is_404(signed_in):
    with respx.mock(assert_all_called=False) as router:
        router.route(host="localhost").pass_through()
        router.post("https://api.intra.42.fr/oauth/token").respond(json={"access_token": "APP", "expires_in": 7200})
        router.get("https://cdn.intra.42.fr/users/a/medium_ana.jpg").respond(404)
        assert (await signed_in.get("/avatar/me")).status_code == 404
