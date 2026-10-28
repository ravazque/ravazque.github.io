import json
import re
from pathlib import Path

import pytest

from app.extract import extract
from app.store import Store
from app.worker import extract_job

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "42.json").read_text())
UID = FIXTURE["user"]["id"]


class FakeApi:
    """Answers like the 42 API from the fixture; records every path."""

    def __init__(self, data=FIXTURE, fail_on=None):
        self.data, self.calls, self.params, self.fail_on = data, [], [], fail_on

    def _answer(self, path, params):
        self.calls.append(path)
        self.params.append((path, params))
        if self.fail_on and self.fail_on in path:
            from app.api42 import Api42Error
            raise Api42Error(503, path)
        d = self.data
        if path == f"/v2/users/{UID}":
            return d["user"]
        if path == f"/v2/users/{UID}/coalitions":
            return d["coalitions"]
        if m := re.match(rf"^/v2/users/{UID}/(.+)$", path):
            key = {"scale_teams/as_corrected": "evals_received", "scale_teams/as_corrector": "evals_given",
                   "correction_point_historics": "correction_points"}.get(m.group(1), m.group(1))
            extra = {"locations_stats": {"2026-10-01": "02:30:00"}, "groups": [{"id": 1, "name": "Peer tutor"}]}
            return d[key] if key in d else extra[key]
        if path == "/v2/achievements_users":
            return d["achievements_users"]
        if path == "/v2/achievements":
            ids = {int(x) for x in params["filter[id]"].split(",")}
            return [a for a in d["achievements"] if a["id"] in ids]
        if m := re.match(r"^/v2/achievements/(\d+)$", path):
            return next((a for a in d["achievements"] if a["id"] == int(m.group(1))), {"id": int(m.group(1)), "name": "?"})
        if path == "/v2/users":
            ids = {int(x) for x in params["filter[id]"].split(",")}
            return [p for p in d["people"] if p["id"] in ids]
        if path == "/v2/projects":
            return d["projects"]
        if path == "/v2/cursus/21/cursus_users":
            return d.get("promo", []) if "range[begin_at]" in params else d["cursus_users_batch"]
        if path == "/v2/feedbacks":
            ids = {int(x) for x in params["filter[feedbackable_id]"].split(",")}
            return [f for f in d.get("feedbacks_api", []) if f["feedbackable_id"] in ids]
        if path == "/v2/blocs":
            return d.get("blocs", [])
        if m := re.match(r"^/v2/users/(\d+)/scale_teams/as_corrector$", path):
            return d.get("contact_evals", {}).get(int(m.group(1)), [])
        if re.match(r"^/v2/coalitions_users/\d+/scores$", path):
            return d.get("coalition_scores", [])
        if path == "/v2/quests_users":
            return d["quests_batch"]
        if path == "/v2/locations":  # the other side's sessions: by user id and a begin_at range
            ids = {int(x) for x in params["filter[user_id]"].split(",")}
            lo, hi = params["range[begin_at]"].split(",")
            return [l for l in d.get("other_locations", []) if l["user"]["id"] in ids and lo <= l["begin_at"] <= hi]
        raise AssertionError(f"unexpected path {path}")

    async def get(self, path, **params):
        return self._answer(path, params)

    async def get_all(self, path, **params):
        return self._answer(path, params)


async def noop(_):
    return None


async def test_extract_light_set_only():
    api = FakeApi()
    data = await extract(api, UID, progress=noop)
    assert data["light"] is True and data["page"] == "web" and set(data["periods"]) == {"piscine", "student", "all"}
    # feedback comes in batches of 100 (/v2/feedbacks), never one request per evaluation; no one else's sessions
    # other people's sessions only through the batched /v2/locations lookup, never one request per person
    assert not any(re.search(r"/scale_teams/\d+/feedbacks", c) or re.search(r"/users/(?!%s/)\d+/locations" % UID, c) for c in api.calls)
    assert all(p.get("image") is None for p in data["periods"]["all"]["people"])
    assert data["periods"]["all"]["profile"]["image"] == "/avatar/me"
    assert set(data["connections"]) == {"piscine", "student", "all"}
    assert data["periods"]["all"]["profile"]["coalition"]["color"]
    stats = data["periods"]["all"]["stats"]
    assert set(stats) >= {"failed_given", "outstanding_reciprocity", "by_group", "by_hour"} and stats["by_group"]
    assert all("track" in p and "xp_earned" in p for p in data["periods"]["all"]["projects"])


async def test_other_people_keep_only_login_name_and_group():
    data = await extract(FakeApi(), UID, progress=noop)
    assert "cdn.intra.42.fr/x.jpg" not in json.dumps(data)
    for nodes in data["connections"].values():
        assert all(set(n) == {"login", "name", "group", "received", "given", "last"} for n in nodes)
    for report in data["periods"].values():
        assert all(p.get("image") is None and "level" not in p and "staff" in p and not p["staff"] for p in report["people"])


async def test_new_student_with_no_history_extracts():
    empty = {**FIXTURE, **{k: [] for k in ("projects_users", "teams", "evals_received", "evals_given", "locations",
                                          "correction_points", "events_users", "quests_users", "titles_users", "expertises_users",
                                          "achievements_users", "people", "projects", "cursus_users_batch", "quests_batch")}}
    data = await extract(FakeApi(empty), UID, progress=noop)
    assert data["periods"]["all"]["logtime"]["sessions"] == 0 and data["connections"]["all"] == []


@pytest.fixture
def ctx(memory, settings):
    return {"store": Store(memory, settings)}


async def test_success_saves_report_and_starts_cooldown(ctx):
    ctx["api"] = FakeApi()
    await extract_job(ctx, UID)
    store = ctx["store"]
    assert (await store.status(UID))["state"] == "done" and (await store.load_report(UID))["light"] is True
    assert 3590 < await store.refresh_wait(UID) <= 3600


async def test_failed_job_keeps_report_and_does_not_start_cooldown(ctx):
    ctx["api"] = FakeApi(fail_on="scale_teams")
    store = ctx["store"]
    await store.save_report(UID, {"old": True})
    await extract_job(ctx, UID)
    s = await store.status(UID)
    assert s["state"] == "failed" and s["message"] == "status.failed"
    assert await store.load_report(UID) == {"old": True} and await store.refresh_wait(UID) == 0
    assert await store.try_lock(UID)  # the lock was released


async def test_progress_ends_at_exactly_one():
    seen = []
    async def record(f):
        seen.append(f)
    await extract(FakeApi(), UID, progress=record)
    assert max(seen) == 1 and seen[-1] == 1 and seen == sorted(seen)


async def test_an_upcoming_evaluation_with_a_hidden_corrector_does_not_break_the_extraction():
    upcoming = {**FIXTURE["evals_received"][0], "id": 1, "corrector": "invisible", "final_mark": None, "flag": None}
    data = await extract(FakeApi({**FIXTURE, "evals_received": FIXTURE["evals_received"] + [upcoming]}), UID, progress=noop)
    assert data["periods"]["all"]["summary"]["received"] == (await extract(FakeApi(), UID, progress=noop))["periods"]["all"]["summary"]["received"]


async def test_a_profile_that_lost_access_is_refused_and_its_data_removed(ctx):
    store = ctx["store"]
    await store.save_report(UID, {"page": "web"})
    user = {**FIXTURE["user"], "cursus_users": [{**c, "end_at": "2026-01-01T00:00:00.000Z", "grade": None}
                                                 if c.get("cursus_id") == 21 else c for c in FIXTURE["user"]["cursus_users"]]}
    api = FakeApi({**FIXTURE, "user": user})
    ctx["api"] = api
    await extract_job(ctx, UID)
    status = await store.status(UID)
    assert status["state"] == "refused" and status["message"] == "blackholed"
    assert await store.load_report(UID) is None
    assert len(api.calls) == 1  # refused right after reading the profile: no budget spent on the rest



def paid_fixture():
    first = FIXTURE["evals_received"][0]
    coalition_id = FIXTURE["coalitions"][0]["id"]
    people = {p["login"]: p["id"] for p in FIXTURE["people"]}
    a, b = sorted(people)[:2]
    return {**FIXTURE,
            "feedbacks_api": [{"feedbackable_id": first["id"], "feedbackable_type": "ScaleTeam", "rating": 4, "comment": "Kind and precise.",
                               "created_at": first["begin_at"], "user": {"id": 1, "login": "ravazque", "image": "x"},
                               "feedback_details": [{"kind": "nice", "rate": 4}, {"kind": "punctuality", "rate": 3}]},
                              {"feedbackable_id": first["id"], "feedbackable_type": "ScaleTeam", "rating": 1, "comment": "A teammate's opinion.",
                               "created_at": first["begin_at"], "user": {"id": 2, "login": "peer07"}, "feedback_details": []}],
            "blocs": [{"coalitions": [{"id": coalition_id, "name": "Mine", "color": "#E39F0B", "score": 500},
                                      {"id": -1, "name": "Other", "color": "#123456", "score": 900}]}],
            "promo": [{"level": 3.0, "user": {"login": "someone"}}, {"level": 9.5, "user": {"login": "other"}},
                      {"level": 16.9, "user": {"login": "ravazque"}}],
            "contact_evals": {people[a]: [{"correcteds": [{"login": b}]}]}}


async def test_paid_extras_are_cheap_bounded_and_keep_no_names():
    api = FakeApi(paid_fixture())
    data = await extract(api, UID, progress=noop)
    assert data["default_period"] == "student"
    assert [c["name"] for c in data["coalitions"]] == ["Other", "Mine"] and data["coalitions"][1]["mine"]
    assert data["promo"]["size"] == 3 and data["promo"]["rank"] == 1
    assert "login" not in json.dumps(data["promo"]) and "someone" not in json.dumps(data)
    assert data["network"]["all"]["nodes"][0] == {"login": "ravazque", "group": "me"}
    assert any(l["count"] == 1 for l in data["network"]["all"]["links"])
    assert sum(1 for c in api.calls if c.endswith("/scale_teams/as_corrector") and f"/{UID}/" not in c) <= 30
    assert sum(1 for c in api.calls if c == "/v2/feedbacks") <= 5


async def test_feedback_details_reach_the_evaluations():
    data = await extract(FakeApi(paid_fixture()), UID, progress=noop)
    first = FIXTURE["evals_received"][0]["id"]
    ev = next(e for e in data["periods"]["all"]["received"] if e["id"] == first)
    assert ev["feedbacks"] and ev["feedbacks"][0]["nice"] == 4 and ev["feedbacks"][0]["comment"] == "Kind and precise."
    assert "image" not in json.dumps(ev["feedbacks"])
    assert [f["by"] for f in ev["feedbacks"]] == ["ravazque"]  # a teammate's feedback on the corrector is not ours to keep


async def test_the_intra_s_hours_and_the_groups_cost_two_requests():
    api = FakeApi()
    data = await extract(api, UID, noop)
    assert f"/v2/users/{UID}/locations_stats" in api.calls and f"/v2/users/{UID}/groups" in api.calls
    every = data["periods"]["all"]
    assert every["logtime"]["official_hours"] == 2.5 and every["profile"]["groups"] == ["Peer tutor"]


async def test_the_coalition_points_cost_one_paged_list_and_feed_the_bonus():
    api = FakeApi()
    data = await extract(api, UID, noop)
    cu = FIXTURE["coalitions_users"][0]["id"]
    assert api.calls.count(f"/v2/coalitions_users/{cu}/scores") == 1
    every = data["periods"]["all"]
    assert every["coalition_points"]["total"] == 6900 and every["logtime_bonus"]["last"] == {"50": "2026-10-04T22:24:23.257Z", "80": "2026-10-07T08:24:17.882Z"}


async def test_without_a_coalition_there_are_no_coalition_points():
    api = FakeApi({**FIXTURE, "coalitions_users": [], "coalitions": []})
    data = await extract(api, UID, noop)
    assert not any("/scores" in c for c in api.calls) and data["periods"]["all"]["coalition_points"]["count"] == 0


async def test_the_other_side_s_seat_is_looked_up_per_day_for_recent_evaluations_only():
    from datetime import datetime, timezone
    from app.extract import _other_sessions
    loc = lambda uid, host, begin, end: {"id": 1, "user": {"id": uid, "login": f"u{uid}"}, "host": host, "begin_at": begin, "end_at": end,  # noqa: E731
                                         "campus_id": 22, "primary": True}
    data = {**FIXTURE, "other_locations": [loc(900004, "c1r1s1", "2026-10-07T18:00:00Z", None),
                                           loc(900001, "c3r2s1", "2026-10-14T15:00:00Z", "2026-10-14T20:00:00Z"),
                                           loc(900001, "c9r9s9", "2026-09-01T10:00:00Z", "2026-09-01T11:00:00Z")]}
    api = FakeApi(data)
    corrector, evaluated = await _other_sessions(api, data, datetime(2026, 10, 16, tzinfo=timezone.utc))
    days = {e["begin_at"][:10] for e in FIXTURE["evals_received"] + FIXTURE["evals_given"] if "2026-08-17" <= e["begin_at"][:10] <= "2026-10-16"}
    assert api.calls.count("/v2/locations") == len(days)  # one request per day with evaluations
    assert corrector["7000169"] == [{"host": "c1r1s1", "begin_at": "2026-10-07T18:00:00Z", "end_at": None}]
    assert evaluated["7000181"]["student03"] == [{"host": "c3r2s1", "begin_at": "2026-10-14T15:00:00Z", "end_at": "2026-10-14T20:00:00Z"}]
    assert evaluated["7000181"]["student06"] == []  # looked up, not logged in
    api = FakeApi(data)  # two months later nothing is recent any more: no request at all
    assert await _other_sessions(api, data, datetime(2026, 12, 31, tzinfo=timezone.utc)) == ({}, {}) and "/v2/locations" not in api.calls


async def test_quests_and_achievements_come_in_batches():
    api = FakeApi()
    data = await extract(api, UID, noop)
    assert not any(re.match(r"^/v2/achievements/\d+$", c) for c in api.calls)  # one batch, never one request each
    quests = [p for path, p in api.params if path == "/v2/quests_users"]
    assert quests and all(p["filter[quest_id]"] == "37,44,45,46,47,48,49" for p in quests)  # only the Common Core ones
    assert data["periods"]["all"]["extras"]["achievements"]
