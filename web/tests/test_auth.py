import pytest

from helpers import signed_callback


async def test_login_needs_the_privacy_policy_accepted(client):
    r = await client.get("/auth/login")
    assert r.status_code == 303 and r.headers["location"] == "/?error=consent"
    assert "__Host-oauth_state" not in r.headers.get("set-cookie", "")


async def test_signing_in_records_when_the_policy_was_accepted(client, mock42, redis, settings):
    from app.store import Store
    mock42.as_profile("student")
    await signed_callback(client)
    assert (await Store(redis, settings).status(192183)).get("privacy_accepted")


async def test_login_sets_state_and_redirects(client):
    r = await client.get("/auth/login?accept=1")
    assert r.status_code == 307 and "state=" in r.headers["location"]
    assert r.headers["location"].startswith("https://api.intra.42.fr/oauth/authorize?")
    assert "redirect_uri=https%3A%2F%2Flocalhost%2Fauth%2Fcallback" in r.headers["location"]
    cookie = r.headers["set-cookie"]
    assert "__Host-oauth_state=" in cookie and "Secure" in cookie and "HttpOnly" in cookie


async def test_callback_rejects_wrong_state(client):
    await client.get("/auth/login?accept=1")
    r = await client.get("/auth/callback?code=x&state=bad")
    assert r.status_code == 400


async def test_callback_without_state_cookie_is_rejected(client):
    r = await client.get("/auth/callback?code=x&state=anything")
    assert r.status_code == 400


@pytest.mark.parametrize("profile,reason", [("staff", "staff"), ("pisciner", "piscine"), ("blackholed", "blackholed"),
                                            ("frozen", "frozen"), ("paris", "campus")])
async def test_refused_profiles_get_no_session_and_nothing_stored(client, redis, mock42, profile, reason):
    mock42.as_profile(profile)
    r = await signed_callback(client)
    assert r.headers["location"] == f"/app/refused?reason={reason}"
    assert "__Host-session" not in r.headers.get("set-cookie", "")
    assert [k for k in await redis.keys("*") if not k.startswith(b"rl:")] == [b"api42:token"] or \
        [k for k in await redis.keys("*") if not k.startswith(b"rl:")] == []


@pytest.mark.parametrize("profile", ["student", "transcender", "alumni"])
async def test_allowed_profiles_get_a_secure_session_cookie(client, mock42, profile):
    mock42.as_profile(profile)
    r = await signed_callback(client)
    cookie = r.headers["set-cookie"]
    assert r.headers["location"] == "/app"
    assert "__Host-session=" in cookie and "Secure" in cookie and "HttpOnly" in cookie and "samesite=lax" in cookie.lower()
    assert "Path=/" in cookie and "Domain" not in cookie


async def test_session_holds_identity_coalition_and_csrf(client, redis, mock42):
    mock42.as_profile("student")
    await signed_callback(client)
    from app.sessions import SessionStore
    sid = client.cookies.get("__Host-session")
    sess = await SessionStore(redis, client._transport.app.state.settings).get(sid)
    assert sess["login"] == "ravazque" and sess["coalition_color"] == "#E39F0B" and len(sess["csrf"]) >= 32


async def test_user_token_never_stored(client, redis, mock42):
    mock42.as_profile("student")
    await signed_callback(client)
    for key in await redis.keys("*"):
        assert b"USER_TOKEN" not in (await redis.dump(key) or b"")


async def test_logout_needs_csrf_then_ends_session(client, redis, mock42):
    mock42.as_profile("student")
    await signed_callback(client)
    assert (await client.post("/auth/logout")).status_code == 403
    sid = client.cookies.get("__Host-session")
    from app.sessions import SessionStore
    csrf = (await SessionStore(redis, client._transport.app.state.settings).get(sid))["csrf"]
    r = await client.post("/auth/logout", headers={"X-CSRF-Token": csrf})
    assert r.status_code == 303 and r.headers["location"] == "/"
    assert await SessionStore(redis, client._transport.app.state.settings).get(sid) is None


async def test_refused_page_explains_reason(client):
    r = await client.get("/app/refused?reason=staff", headers={"Accept-Language": "en"})
    assert r.status_code == 200 and "staff" in r.text.lower()


async def test_first_sign_in_enqueues_later_sign_ins_do_not(client, mock42, redis, settings, arq_pool):
    from app.store import Store
    mock42.as_profile("student")
    await signed_callback(client)
    assert arq_pool.enqueued == ["extract_job"]
    store = Store(redis, settings)
    await store.save_report(mock42.uid, {"x": 1}); await store.unlock(mock42.uid)
    await signed_callback(client)
    assert arq_pool.enqueued == ["extract_job"]
