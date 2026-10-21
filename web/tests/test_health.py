async def test_healthz(client):
    r = await client.get("/healthz")
    assert r.status_code == 200 and r.json() == {"ok": True}


async def test_static_and_shared_frontend_served(client):
    assert (await client.get("/shared/report.js")).status_code == 200
    assert (await client.get("/shared/vendor/chart.umd.min.js")).status_code == 200


async def test_ui_css_generated_from_ui_json(client):
    r = await client.get("/ui.css")
    assert r.headers["content-type"].startswith("text/css") and "--c-button-height: 44px" in r.text
    assert r.headers["cache-control"] == "no-cache"
