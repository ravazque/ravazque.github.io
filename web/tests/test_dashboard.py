import re

import pytest


@pytest.mark.parametrize("path,page", [("/app", "web-home"), ("/app/corrections", "web-corrections"), ("/app/campus", "web-campus")])
async def test_dashboard_pages_need_a_session(client, path, page):
    r = await client.get(path)
    assert r.status_code == 303 and r.headers["location"] == "/"


@pytest.mark.parametrize("path,page", [("/app", "web-home"), ("/app/corrections", "web-corrections"), ("/app/campus", "web-campus")])
async def test_dashboard_pages_render_the_shared_report(signed_in, path, page):
    r = await signed_in.get(path)
    assert r.status_code == 200
    assert f'data-page="{page}"' in r.text and f'data-csrf="{signed_in.csrf["X-CSRF-Token"]}"' in r.text
    for asset in ("/ui.css", "/shared/controls.css", "/shared/report.css", "/shared/report.js", "/shared/accent.js", "/static/app.js"):
        assert asset in r.text
    assert "{{" not in r.text
    for href in ('href="/about"', 'href="/privacy"', 'href="https://github.com/example/logbook/issues/new/choose"'):
        assert href in r.text
    assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", r.text)
    assert "onerror=" not in r.text


async def test_dashboard_carries_the_coalition_colour(signed_in):
    r = await signed_in.get("/app")
    assert 'data-accent="#3E7BC8"' in r.text
