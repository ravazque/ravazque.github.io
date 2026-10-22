import pytest

from helpers import signed_callback


async def test_login_needs_the_privacy_policy_accepted(client):
    r = await client.get("/auth/login")
    assert r.status_code == 303 and r.headers["location"] == "/?error=consent"
    assert "__Host-oauth_state" not in r.headers.get("set-cookie", "")


async def test_signing_in_records_the_accepted_policy_version_without_the_id(client, mock42, memory, settings):
    from app import consent
    from app.store import Store
    mock42.as_profile("student")
    await signed_callback(client)
    store = Store(memory, settings)
    assert await consent.is_current(store, 192183)
    keys = [k.decode() for k in await memory.keys("consent:*")]
    assert len(keys) == 1 and "192183" not in keys[0]
    assert 2 * 365 * 86400 - 60 < await memory.ttl(keys[0]) <= 2 * 365 * 86400


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
async def test_refused_profiles_get_no_session_and_nothing_stored(client, memory, mock42, profile, reason):
    mock42.as_profile(profile)
    r = await signed_callback(client)
    assert r.headers["location"] == f"/app/refused?reason={reason}"
    assert "__Host-session" not in r.headers.get("set-cookie", "")
    assert [k for k in await memory.keys("*") if not k.startswith(b"rl:")] == [b"api42:token"] or \
        [k for k in await memory.keys("*") if not k.startswith(b"rl:")] == []


@pytest.mark.parametrize("profile", ["student", "transcender", "alumni"])
async def test_allowed_profiles_get_a_secure_session_cookie(client, mock42, profile):
    mock42.as_profile(profile)
    r = await signed_callback(client)
    cookie = r.headers["set-cookie"]
    assert r.headers["location"] == "/app"
    assert "__Host-session=" in cookie and "Secure" in cookie and "HttpOnly" in cookie and "samesite=lax" in cookie.lower()
    assert "Path=/" in cookie and "Domain" not in cookie


async def test_session_holds_identity_coalition_and_csrf(client, memory, mock42):
    mock42.as_profile("student")
    await signed_callback(client)
    from app.sessions import SessionStore
    sid = client.cookies.get("__Host-session")
    sess = await SessionStore(memory, client._transport.app.state.settings).get(sid)
    assert sess["login"] == "ravazque" and sess["coalition_color"] == "#E39F0B" and len(sess["csrf"]) >= 32


async def test_user_token_never_stored(client, memory, mock42):
    mock42.as_profile("student")
    await signed_callback(client)
    assert await memory.keys("*") and "USER_TOKEN" not in repr(memory.data)


async def test_logout_needs_csrf_then_ends_session(client, memory, mock42):
    mock42.as_profile("student")
    await signed_callback(client)
    assert (await client.post("/auth/logout")).status_code == 403
    sid = client.cookies.get("__Host-session")
    from app.sessions import SessionStore
    csrf = (await SessionStore(memory, client._transport.app.state.settings).get(sid))["csrf"]
    r = await client.post("/auth/logout", headers={"X-CSRF-Token": csrf})
    assert r.status_code == 303 and r.headers["location"] == "/"
    assert await SessionStore(memory, client._transport.app.state.settings).get(sid) is None


async def test_refused_page_explains_reason(client):
    r = await client.get("/app/refused?reason=staff", headers={"Accept-Language": "en"})
    assert r.status_code == 200 and "staff" in r.text.lower()


async def test_first_sign_in_enqueues_later_sign_ins_do_not(client, mock42, memory, settings, jobs):
    from app.store import Store
    mock42.as_profile("student")
    await signed_callback(client)
    assert jobs.enqueued == ["extract_job"]
    store = Store(memory, settings)
    await store.save_report(mock42.uid, {"x": 1}); await store.unlock(mock42.uid)
    await signed_callback(client)
    assert jobs.enqueued == ["extract_job"]


async def test_acceptances_survive_a_restart_through_the_consent_log(tmp_path, settings):
    import json as _json
    from dataclasses import replace

    from app import consent
    from app.memory import Memory
    from app.store import Store
    s = replace(settings, consent_log=str(tmp_path / "consent.log"))
    await consent.record(Store(Memory(), s), 192183)
    line = _json.loads((tmp_path / "consent.log").read_text().splitlines()[0])
    assert set(line) == {"h", "v", "at"} and "192183" not in str(line)
    fresh = Memory()
    await consent.load(fresh, s)
    assert await consent.is_current(Store(fresh, s), 192183)


async def test_old_acceptances_are_pruned_from_the_log(tmp_path, settings):
    import json as _json
    from dataclasses import replace

    from app import consent
    from app.memory import Memory
    log = tmp_path / "consent.log"
    log.write_text(_json.dumps({"h": "a", "v": 1, "at": "2020-01-01T00:00:00+00:00"}) + "\n"
                   + _json.dumps({"h": "b", "v": 1, "at": "2099-01-01T00:00:00+00:00"}) + "\n")
    await consent.load(Memory(), replace(settings, consent_log=str(log)))
    assert [_json.loads(x)["h"] for x in log.read_text().splitlines()] == ["b"]
