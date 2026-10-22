import base64
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import respx

from app.publish import GITHUB_API, SITE_DATA_PATH, PublishError, is_fresh, publish_snapshot, snapshot
from app.settings import Settings
from app.store import Store


def report(grade="Transcender", quests=("Common Core Rank 00", "Common Core Rank 01", "Common Core")):
    profile = {"login": "ravazque", "name": "Raúl Vázquez Pérez", "email": "ravazque@example.invalid", "image": "/avatar/me",
               "campus": ["Forty2", "Madrid"], "location": "c1r2s3", "wallet": 476, "correction_point": 11,
               "coalition": {"name": "Zefiria", "color": "#E39F0B", "score": 500, "rank": 10}}
    extras = {"cursus": [{"name": "C Piscine", "level": 4.67, "grade": "Pisciner", "begin": "2024-07-01 10:16", "blackholed": None},
                         {"name": "42cursus", "level": 16.9, "grade": grade, "begin": "2024-09-16 09:42", "blackholed": None}],
              "quests": [{"name": q, "validated": f"2025-0{i + 1}-10 12:00"} for i, q in enumerate(quests)],
              "skills": [{"name": f"Skill {i}", "level": 10 - i} for i in range(9)],
              "titles": [{"name": "Mastermind ravazque", "selected": True}, {"name": "Philanthropist ravazque", "selected": False}],
              "skills_by_cursus": {"42cursus": [{"name": "Algorithms & AI", "level": 12.08}, {"name": "Basics", "level": 0}],
                                   "C Piscine": [{"name": "Rigor", "level": 2.1}, {"name": "Unix", "level": 0}]},
              "achievements": [{"name": "Welcome, Cadet !"}]}
    projects = [
        {"name": "C Piscine Shell 00", "track": "piscine", "group": "piscine", "validated": True, "mark": 60, "xp_earned": 0,
         "marked": "2024-07-03 11:20", "status": "finished", "registered": "2024-07-01 09:00", "correctors": ["peer01"]},
        {"name": "Libft", "track": "common-core", "group": "rank-00", "validated": True, "mark": 125, "xp_earned": 578,
         "marked": "2024-10-01 10:00", "status": "finished", "registered": "2024-09-16 10:00", "correctors": ["peer02"]},
        {"name": "minishell", "track": "common-core", "group": "rank-03", "validated": True, "mark": 101, "xp_earned": 2850,
         "marked": "2025-03-02 18:30", "status": "finished", "registered": "2025-01-10 10:00", "correctors": ["peer03"]},
        {"name": "ft_transcendence", "track": "common-core", "group": "rank-06", "validated": False, "mark": None, "xp_earned": 0,
         "marked": None, "status": "in_progress", "registered": "2026-09-01 10:00", "correctors": []},
        {"name": "C Piscine Exam 02", "track": "piscine", "group": "piscine", "validated": False, "mark": None, "xp_earned": 0,
         "marked": None, "status": "in_progress", "registered": "2024-07-18 10:00", "correctors": []},
    ]
    summary = {"given": 232, "given_outstanding": 28, "received": 163, "received_outstanding": 43, "received_avg_mark": 91.8,
               "logtime_hours": 601.7, "unique_correctors": 115}
    period = {"profile": profile, "extras": extras, "projects": projects, "summary": summary,
              "people": [{"login": "peer01", "name": "Peer One"}], "logtime": {"sessions": [1, 2]}, "place": {"seats": ["c1r2s3"]}}
    return {"page": "web", "periods": {"all": period, "student": {**period, "summary": {**summary, "given": 200, "received": 140}}},
            "connections": {"all": [{"login": "peer02", "name": "Peer Two"}]}}


UPDATED = "2026-10-18T19:02:00+00:00"


def test_snapshot_keeps_only_the_whitelisted_fields():
    snap = snapshot(report(), UPDATED)
    assert set(snap) == {"schema", "updated", "login", "name", "campus", "title", "coalition", "cursus", "skills",
                         "projects", "evaluations"}
    text = json.dumps(snap, ensure_ascii=False)
    for leak in ("@", "example.invalid", "c1r2s3", "avatar", "peer0", "Peer ", "wallet", "476", "601", "logtime", "correctors"):
        assert leak not in text, leak


def test_snapshot_cursus_status():
    snap = snapshot(report(), UPDATED)
    assert snap["cursus"] == {"level": 16.9, "grade": "Transcender", "stage": "outer-core", "kickoff": "2024-09-16",
                              "common_core": "2025-03-10"}
    assert snap["coalition"] == {"name": "Zefiria", "color": "#E39F0B"}
    assert snap["title"] == "Mastermind ravazque" and snap["campus"] == "42 Madrid"


def test_snapshot_stage_follows_the_rank_being_worked_on():
    snap = snapshot(report(grade=None, quests=("Common Core Rank 00", "Common Core Rank 01", "Common Core Rank 02")), UPDATED)
    assert snap["cursus"]["stage"] == "rank-03" and snap["cursus"]["common_core"] is None
    assert snapshot(report(grade="Alumni"), UPDATED)["cursus"]["stage"] == "alumni"


def test_snapshot_lists_every_validated_project_newest_first_with_track_group_and_xp():
    snap = snapshot(report(), UPDATED)
    assert snap["projects"]["list"] == [
        {"name": "minishell", "track": "common-core", "group": "rank-03", "mark": 101, "xp": 2850, "validated": "2025-03-02"},
        {"name": "Libft", "track": "common-core", "group": "rank-00", "mark": 125, "xp": 578, "validated": "2024-10-01"},
        {"name": "C Piscine Shell 00", "track": "piscine", "group": "piscine", "mark": 60, "xp": 0, "validated": "2024-07-03"}]
    assert snap["projects"]["validated"] == 2  # the 42cursus ones; the list carries the piscine too, for the filter
    assert snap["projects"]["in_progress"] == [{"name": "ft_transcendence", "track": "common-core", "group": "rank-06", "since": "2026-09-01"}]


def test_snapshot_evaluations_count_the_student_period_and_skills_come_in_full_for_both_radars():
    snap = snapshot(report(), UPDATED)
    assert snap["evaluations"] == {"given": 200, "given_outstanding": 28, "received": 140, "received_outstanding": 43,
                                   "received_avg_mark": 91.8}
    assert snap["skills"] == {"student": [{"name": "Algorithms & AI", "level": 12.08}, {"name": "Basics", "level": 0}],
                              "piscine": [{"name": "Rigor", "level": 2.1}, {"name": "Unix", "level": 0}]}


def test_is_fresh_within_the_hour():
    now = datetime(2026, 10, 18, 20, 0, tzinfo=timezone.utc)
    assert is_fresh((now - timedelta(minutes=59)).isoformat(), now, 3600)
    assert not is_fresh((now - timedelta(minutes=61)).isoformat(), now, 3600)
    assert not is_fresh(None, now, 3600) and not is_fresh("garbage", now, 3600)


GH = Settings(github_token="TOKEN", github_repo="ravazque/ravazque.github.io", github_branch="main")
CONTENTS = f"{GITHUB_API}/repos/ravazque/ravazque.github.io/contents/{SITE_DATA_PATH}"


async def test_publish_updates_the_existing_file():
    with respx.mock() as gh:
        gh.get(CONTENTS, params={"ref": "main"}).respond(200, json={"sha": "OLD"})
        put = gh.put(CONTENTS).respond(200, json={"commit": {"html_url": "https://github.com/c/1"}})
        async with httpx.AsyncClient() as http:
            url = await publish_snapshot(http, GH, {"login": "ravazque"})
    body = json.loads(put.calls.last.request.content)
    assert url == "https://github.com/c/1"
    assert body["sha"] == "OLD" and body["branch"] == "main" and body["message"].startswith("site: ")
    assert json.loads(base64.b64decode(body["content"])) == {"login": "ravazque"}
    assert put.calls.last.request.headers["authorization"] == "Bearer TOKEN"


async def test_publish_creates_the_file_the_first_time():
    with respx.mock() as gh:
        gh.get(CONTENTS, params={"ref": "main"}).respond(404, json={"message": "Not Found"})
        put = gh.put(CONTENTS).respond(201, json={"commit": {"html_url": "https://github.com/c/2"}})
        async with httpx.AsyncClient() as http:
            assert await publish_snapshot(http, GH, {}) == "https://github.com/c/2"
    assert "sha" not in json.loads(put.calls.last.request.content)


async def test_publish_raises_on_github_errors():
    with respx.mock() as gh:
        gh.get(CONTENTS, params={"ref": "main"}).respond(401, json={"message": "Bad credentials"})
        async with httpx.AsyncClient() as http:
            with pytest.raises(PublishError):
                await publish_snapshot(http, GH, {})


# --- route ---------------------------------------------------------------------------------------------------------

@pytest.fixture
def owner_settings(settings):
    from dataclasses import replace
    return replace(settings, owner_login="ana", github_token="TOKEN", github_repo="ravazque/ravazque.github.io")


@pytest.fixture
async def owner(owner_settings, memory, jobs):
    from app.main import create_app
    from app.sessions import COOKIE, SessionStore
    app = create_app(owner_settings, memory, jobs=jobs)
    sid = await SessionStore(memory, owner_settings).create({"id": 7, "login": "ana", "name": "Ana", "coalition_color": "#3E7BC8"})
    csrf = (await SessionStore(memory, owner_settings).get(sid))["csrf"]
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://localhost")
    client.cookies.set(COOKIE, sid)
    client.headers["X-CSRF-Token"] = csrf
    yield client, Store(memory, owner_settings)
    await client.aclose()


def just_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


async def test_publish_route_needs_csrf(signed_in):
    assert (await signed_in.post("/api/me/publish")).status_code == 403


async def test_publish_route_is_only_for_the_owner(signed_in):
    r = await signed_in.post("/api/me/publish", headers=signed_in.csrf)
    assert r.status_code == 403 and r.json() == {"error": "owner"}


async def test_publish_route_is_off_without_a_token(owner, owner_settings, memory, jobs):
    client, store = owner
    from dataclasses import replace
    client._transport.app.state.settings = replace(owner_settings, github_token="")
    r = await client.post("/api/me/publish")
    assert r.status_code == 503 and r.json() == {"error": "publish-off"}


async def test_publish_route_refuses_a_stale_profile(owner):
    client, store = owner
    await store.save_report(7, report())
    await store.set_status(7, state="done", last=(datetime.now(timezone.utc) - timedelta(hours=2)).isoformat())
    r = await client.post("/api/me/publish")
    assert r.status_code == 409 and r.json() == {"error": "stale"}


async def test_publish_route_commits_the_snapshot(owner):
    client, store = owner
    await store.save_report(7, report())
    await store.set_status(7, state="done", last=just_now())
    with respx.mock(assert_all_called=False) as gh:
        gh.route(host="localhost").pass_through()
        gh.get(CONTENTS, params={"ref": "main"}).respond(200, json={"sha": "OLD"})
        put = gh.put(CONTENTS).respond(200, json={"commit": {"html_url": "https://github.com/c/3"}})
        r = await client.post("/api/me/publish")
    assert r.status_code == 200 and r.json()["url"] == "https://github.com/c/3"
    assert json.loads(base64.b64decode(json.loads(put.calls.last.request.content)["content"]))["login"] == "ravazque"
    assert (await client.get("/api/me/status")).json()["published"]


async def test_publish_route_reports_github_failures(owner):
    client, store = owner
    await store.save_report(7, report())
    await store.set_status(7, state="done", last=just_now())
    with respx.mock(assert_all_called=False) as gh:
        gh.route(host="localhost").pass_through()
        gh.get(CONTENTS, params={"ref": "main"}).respond(500)
        r = await client.post("/api/me/publish")
    assert r.status_code == 502 and r.json() == {"error": "github"}


async def test_dashboard_marks_the_owner_for_the_publish_button(owner, signed_in):
    client, store = owner
    assert 'href="/app/publish"' in (await client.get("/app")).text
    assert 'href="/app/publish"' not in (await signed_in.get("/app")).text
    assert 'action="/app/publish"' in (await client.get("/app/publish")).text
    assert (await client.post("/app/publish", headers={"X-CSRF-Token": "wrong"})).status_code == 403
