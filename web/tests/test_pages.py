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
    assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", (await client.get(path)).text)


async def test_lang_cookie_wins_over_browser(client):
    r = await client.post("/lang", data={"lang": "es", "next": "/about"}, headers={"Accept-Language": "en"})
    assert r.status_code == 303 and r.headers["location"] == "/about" and "lang=es" in r.headers["set-cookie"]
    assert 'lang="es"' in (await client.get("/about", headers={"Accept-Language": "en"})).text


async def test_lang_rejects_open_redirects_and_unknown_languages(client):
    r = await client.post("/lang", data={"lang": "xx", "next": "https://evil.example"})
    assert r.headers["location"] == "/" and "lang=" not in r.headers.get("set-cookie", "")


async def test_privacy_mentions_retention_cookie_cooldown_and_contact(client):
    r = await client.get("/privacy", headers={"Accept-Language": "en"})
    for s in ("30 days", "__Host-session", "owner@example.invalid", "60 minutes", "rank group"):
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
