import re

import pytest


async def test_landing_in_spanish_from_accept_language(client):
    r = await client.get("/", headers={"Accept-Language": "es-ES,es;q=0.9"})
    assert r.status_code == 200 and "Iniciar sesión con 42" in r.text and 'lang="es"' in r.text


async def test_landing_in_english_by_default(client):
    r = await client.get("/")
    assert "Sign in with 42" in r.text and 'lang="en"' in r.text and 'action="/auth/login"' in r.text
    assert 'name="accept"' in r.text and "required" in r.text and 'href="/privacy"' in r.text


async def test_landing_explains_a_missing_consent(client):
    r = await client.get("/?error=consent")
    assert 'role="alert"' in r.text and "privacy policy" in r.text


@pytest.mark.parametrize("path", ["/", "/about", "/privacy", "/app/refused"])
async def test_public_pages_link_about_privacy_and_issues(client, path):
    r = await client.get(path)
    for href in ('href="/about"', 'href="/privacy"', 'href="https://github.com/example/logbook/issues/new/choose"'):
        assert href in r.text


@pytest.mark.parametrize("path", ["/", "/about", "/privacy"])
async def test_public_pages_have_no_inline_scripts(client, path):
    assert not re.search(r"<script\b(?![^>]*\bsrc=)[^>]*>", (await client.get(path)).text, re.IGNORECASE)


async def test_lang_cookie_wins_over_browser(client):
    r = await client.post("/lang", data={"lang": "es", "next": "/about"}, headers={"Accept-Language": "en"})
    assert r.status_code == 303 and r.headers["location"] == "/about" and "lang=es" in r.headers["set-cookie"]
    assert 'lang="es"' in (await client.get("/about", headers={"Accept-Language": "en"})).text


async def test_lang_rejects_open_redirects_and_unknown_languages(client):
    r = await client.post("/lang", data={"lang": "xx", "next": "https://evil.example"})
    assert r.headers["location"] == "/" and "lang=" not in r.headers.get("set-cookie", "")


async def test_privacy_mentions_retention_cookie_cooldown_and_contact(client):
    r = await client.get("/privacy", headers={"Accept-Language": "en"})
    for s in ("IndexedDB", "never written to disk", "__Host-session", "owner@example.invalid", "60 minutes", "rank group"):
        assert s in r.text


async def test_about_mentions_hourly_refresh_and_madrid(client):
    r = await client.get("/about", headers={"Accept-Language": "en"})
    assert "42 Madrid" in r.text and "once an hour" in r.text


async def test_signed_in_landing_goes_to_app(signed_in):
    r = await signed_in.get("/")
    assert r.status_code == 303 and r.headers["location"] == "/app"


async def test_favicons_served(client):
    for path, kind in (("/static/favicon.svg", "image/svg+xml"), ("/static/favicon-32.png", "image/png"), ("/static/apple-touch-icon.png", "image/png")):
        r = await client.get(path)
        assert r.status_code == 200 and r.headers["content-type"].startswith(kind)


async def test_reading_pages_have_no_header_and_a_back_link_to_where_you_came_from(client):
    r = await client.get("/about", headers={"referer": "https://localhost/app/projects?period=all"})
    assert 'class="site-head"' not in r.text and 'class="back"' in r.text
    assert 'href="/app/projects?period=all"' in r.text
    r = await client.get("/privacy", headers={"referer": "https://evil.example/app"})
    assert 'class="back" href="/"' in r.text  # another host never becomes the link
    r = await client.get("/privacy")
    assert 'class="back" href="/"' in r.text


async def test_the_landing_shows_what_you_will_see_in_a_dialog(client):
    text = (await client.get("/", headers={"Accept-Language": "en"})).text
    assert re.search(r'<a [^>]*href="/about#features"[^>]*data-features', text)  # without JavaScript: the About list
    dialog = text[text.index('<dialog id="features"'):text.index("</dialog>")]
    for s in ("Time on campus", "hour you logged", "who evaluated you", "how long it lasted", "computers you used most", "alumni"):
        assert s in dialog, s
    assert 'method="dialog"' in dialog


async def test_about_says_why_what_and_how_without_promises(client):
    text = (await client.get("/about", headers={"Accept-Language": "en"})).text
    for h in ("Why this project?", "What you can see", "How it is built", "Beta"):
        assert re.search(rf"<h2[^>]*>{re.escape(h)}</h2>", text), h
    assert 'id="features"' in text and text.count("<li>") >= 10
    assert "Coming soon" not in text and "FastAPI" in text and "not affiliated with" in text


async def test_phones_and_tablets_get_the_pages_without_a_block(client):
    for path in ("/", "/about", "/privacy"):
        assert "touch-block" not in (await client.get(path)).text


async def test_what_you_will_see_sits_by_sign_in_and_its_dialog_is_only_the_modules(client):
    text = (await client.get("/", headers={"Accept-Language": "en"})).text
    form = text[text.index('<form class="signin"'):text.index("</form>", text.index('<form class="signin"'))]
    assert "data-features" in form  # beside the sign-in button
    dialog = text[text.index('<dialog id="features"'):text.index("</dialog>")]
    assert "<h2" not in dialog and "Only your data" not in dialog and "The full list" not in dialog
    assert re.search(r'class="features-actions".*method="dialog".*data-go-signin', dialog, re.S)
    for s in ("hours", "seat", "evaluated", "correctors"):
        assert s in dialog
