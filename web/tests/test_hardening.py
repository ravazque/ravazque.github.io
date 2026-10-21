"""Sign-in and session edges: network failures, cookie deletion, the shared limiter, the session secret, lost access."""
import httpx
import pytest

from app.api42 import API
from app.settings import Settings
from app.store import Store
from helpers import signed_callback


async def test_sign_in_survives_a_network_error_at_the_token_exchange(client, mock42):
    mock42.as_profile("student")
    mock42.router.post(f"{API}/oauth/token").mock(side_effect=httpx.ConnectTimeout("slow"))
    r = await signed_callback(client)
    assert r.status_code == 303 and r.headers["location"] == "/?error=signin"


async def test_sign_in_survives_a_failing_coalitions_call(client, mock42, redis, settings):
    mock42.as_profile("student")
    mock42.router.get(f"{API}/v2/users/192183/coalitions").mock(side_effect=httpx.ReadTimeout("slow"))
    r = await signed_callback(client)
    assert r.status_code == 303 and r.headers["location"] == "/app"
    from app.sessions import SessionStore
    session = await SessionStore(redis, settings).get(client.cookies.get("__Host-session"))
    assert session["login"] == "ravazque" and session["coalition_color"] is None


async def test_cookies_are_cleared_as_secure_host_cookies(client, mock42, redis, settings):
    mock42.as_profile("student")
    r = await signed_callback(client)
    state_clear = [c for c in r.headers.get_list("set-cookie") if c.startswith("__Host-oauth_state=")]
    assert state_clear and all("Secure" in c for c in state_clear)
    from app.sessions import SessionStore
    csrf = (await SessionStore(redis, settings).get(client.cookies.get("__Host-session")))["csrf"]
    r = await client.post("/auth/logout", headers={"X-CSRF-Token": csrf})
    cleared = [c for c in r.headers.get_list("set-cookie") if c.startswith("__Host-session=")]
    assert cleared and all("Secure" in c and "Path=/" in c for c in cleared)


async def test_avatar_downloads_go_through_the_shared_rate_limiter(signed_in, mock42, redis):
    mock42.as_profile("student")
    mock42.router.get("https://cdn.intra.42.fr/users/a/medium_ana.jpg").respond(200, content=b"jpg", headers={"content-type": "image/jpeg"})
    before = [k async for k in redis.scan_iter("rl:sec:*")]
    r = await signed_in.get("/avatar/me")
    assert r.status_code == 200 and r.content == b"jpg"
    assert len([k async for k in redis.scan_iter("rl:sec:*")]) > len(before)


def test_the_session_secret_must_be_set_and_long():
    for bad in ("", "short"):
        with pytest.raises(ValueError):
            Settings(session_secret=bad, contact_email="a@example.invalid").check()
    Settings(session_secret="s" * 32, contact_email="a@example.invalid").check()


def test_the_contact_email_must_be_set():
    with pytest.raises(ValueError):
        Settings(session_secret="s" * 32).check()


def test_the_app_does_not_start_without_a_session_secret(monkeypatch):
    from app.main import build
    monkeypatch.setenv("SESSION_SECRET", "")
    with pytest.raises(ValueError):
        build()


async def test_a_profile_that_lost_access_is_sent_to_the_refused_page(signed_in, redis, settings):
    await Store(redis, settings).set_status(7, state="refused", message="blackholed")
    r = await signed_in.get("/app", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/app/refused?reason=blackholed"


async def test_signing_in_again_after_regaining_access_clears_the_refusal(client, mock42, redis, settings, arq_pool):
    store = Store(redis, settings)
    await store.set_status(192183, state="refused", message="frozen")
    await store.start_cooldown(192183)
    mock42.as_profile("student")
    r = await signed_callback(client)
    assert r.headers["location"] == "/app"
    assert (await store.status(192183))["state"] != "refused"
    assert arq_pool.enqueued  # a fresh extraction starts at once


async def test_the_avatar_is_only_fetched_from_the_intra_cdn(client, mock42, redis, settings):
    from app.sessions import COOKIE, SessionStore
    mock42.as_profile("student")
    elsewhere = mock42.router.get("https://elsewhere.example/a.jpg").respond(200, content=b"x")
    sid = await SessionStore(redis, settings).create({"id": 7, "login": "ana", "image": "https://elsewhere.example/a.jpg"})
    client.cookies.set(COOKIE, sid)
    assert (await client.get("/avatar/me")).status_code == 404
    assert not elsewhere.called


async def test_sign_in_callbacks_are_limited_per_address(client, mock42):
    from app.auth import CALLBACKS_PER_WINDOW
    mock42.as_profile("student")
    token = mock42.router.post(f"{API}/oauth/token").respond(401)
    for _ in range(CALLBACKS_PER_WINDOW):
        assert (await signed_callback(client)).status_code == 303
    calls = token.call_count
    r = await signed_callback(client)
    assert r.status_code == 429 and token.call_count == calls
