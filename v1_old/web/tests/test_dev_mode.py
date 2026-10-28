"""make dev: the last saved report is served at once and one link signs in as its owner. Only ever on localhost."""
import json
from dataclasses import replace

import httpx
import pytest

from app.main import create_app
from app.memory import Memory
from app.settings import Settings
from app.store import Store
from test_extract import UID, FakeApi
from app.extract import extract


async def _noop(_):
    pass


def test_dev_mode_refuses_to_run_outside_localhost():
    base = dict(session_secret="s" * 32, contact_email="a@example.invalid", controller_name="A", dev_report="/x.json", dev_uid=1)
    with pytest.raises(ValueError):
        Settings(base_url="https://ravazque.info", **base).check()
    Settings(base_url="https://localhost", **base).check()


async def test_without_a_saved_report_there_is_no_dev_login(client):
    assert (await client.get("/dev/login")).status_code == 404


@pytest.fixture
async def dev_client(tmp_path, settings):
    data = await extract(FakeApi(), UID, _noop)
    path = tmp_path / "data.json"
    path.write_text(json.dumps(data))
    s = replace(settings, dev_report=str(path), dev_uid=UID)
    memory = Memory()
    app = create_app(s, memory)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://localhost") as c:
            yield c, memory, s


async def test_the_saved_report_is_served_at_once(dev_client):
    client, memory, settings = dev_client
    landing = await client.get("/")
    assert 'href="/dev/login"' in landing.text
    r = await client.get("/dev/login")
    assert r.status_code == 303 and r.headers["location"] == "/app"
    page = await client.get("/app")
    assert '<section id="home-kpis"' in page.text
    assert await Store(memory, settings).load_report(UID) is not None


@pytest.fixture
async def dev_with_tests(tmp_path, settings):
    data = await extract(FakeApi(), UID, _noop)
    (tmp_path / "data.json").write_text(json.dumps(data))
    test = json.loads(json.dumps(data))
    for p in test["periods"].values():
        p["profile"]["login"], p["profile"]["name"] = "tnova", "Nova Tester"
    test["test_profile"] = 990001
    (tmp_path / "test-new.json").write_text(json.dumps(test))
    owner = data["periods"]["all"]["profile"]["login"]
    s = replace(settings, dev_report=str(tmp_path / "data.json"), dev_uid=UID, owner_login=owner, github_token="t", github_repo="o/r")
    memory = Memory()
    app = create_app(s, memory)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://localhost") as c:
            yield c, memory, s


async def test_test_profiles_sit_beside_the_saved_report_and_never_publish(dev_with_tests):
    client, memory, settings = dev_with_tests
    landing = (await client.get("/")).text
    assert 'href="/dev/login"' in landing and 'href="/dev/login?as=tnova"' in landing
    r = await client.get("/dev/login?as=tnova")
    assert r.status_code == 303 and r.headers["location"] == "/app"
    page = (await client.get("/app")).text
    assert "Nova Tester" in page and "/app/publish" not in page
    assert (await client.get("/app/publish")).status_code in (303, 403, 404)
    assert (await client.get("/dev/login?as=nobody")).status_code == 404
