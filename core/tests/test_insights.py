from datetime import datetime, timezone

from core42.insights import (campus_history, coalition_standings, contact_network, evaluation_depth, exams, pace,
                             promo_standing, teammates)

NOW = datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc)


def test_campus_history_lists_every_campus_with_its_time_and_the_primary_first():
    user = {"campus": [{"id": 66, "name": "Forty2", "city": "Oléron"}, {"id": 22, "name": "Madrid", "city": "Madrid"}],
            "campus_users": [{"campus_id": 66, "is_primary": False, "created_at": "2025-08-23T10:00:00Z"},
                             {"campus_id": 22, "is_primary": True, "created_at": "2024-07-01T08:15:00Z"}]}
    locations = [{"campus_id": 22, "begin_at": "2024-07-01T09:00:00Z", "end_at": "2024-07-01T11:00:00Z"},
                 {"campus_id": 22, "begin_at": "2024-07-01T10:00:00Z", "end_at": "2024-07-01T12:00:00Z"},  # overlaps: once
                 {"campus_id": 22, "begin_at": "2026-10-15T08:00:00Z", "end_at": "2026-10-15T09:30:00Z"}]
    rows = campus_history(user, locations, NOW)
    assert [r["name"] for r in rows] == ["Madrid", "Forty2"]
    madrid, forty2 = rows
    assert madrid == {"id": 22, "name": "Madrid", "city": "Madrid", "primary": True, "joined": "2024-07-01",
                      "sessions": 3, "hours": 4.5, "first": "2024-07-01", "last": "2026-10-15"}
    assert forty2["sessions"] == 0 and forty2["hours"] == 0 and forty2["first"] is None and not forty2["primary"]


def project(name, attempts, exam=False, track="common-core", validated=True, xp=0, marked=None):
    return {"name": name, "exam": exam, "track": track, "validated": validated, "xp_earned": xp, "marked": marked,
            "mark": max((a["mark"] or 0) for a in attempts) if attempts else None, "attempts": attempts}


def attempt(start, mark, members=(), validated=True):
    return {"start": start, "mark": mark, "members": list(members), "validated": validated}


def test_teammates_count_shared_teams_most_frequent_first():
    projects = [project("minishell", [attempt("2025-01-01 10:00", 101, ["me", "ana"])]),
                project("cub3d", [attempt("2025-03-01 10:00", 100, ["me", "ana"])]),
                project("webserv", [attempt("2025-05-01 10:00", 0, ["me", "bob", "ana"], False),
                                    attempt("2025-06-01 10:00", 125, ["me", "bob"])])]
    names = {"ana": "Ana A", "bob": "Bob B"}
    assert teammates(projects, "me", names) == [
        {"login": "ana", "name": "Ana A", "teams": 3, "projects": {"minishell": 1, "cub3d": 1, "webserv": 1}},
        {"login": "bob", "name": "Bob B", "teams": 2, "projects": {"webserv": 2}}]  # two teams on one project: webserv (x2)


def test_exams_list_every_try_and_the_days_until_passed():
    projects = [project("Exam Rank 02", [attempt("2024-11-01 10:00", 0, validated=False), attempt("2024-11-15 10:00", 100)], exam=True),
                project("Libft", [attempt("2024-10-01 10:00", 125)])]
    assert exams(projects) == [{"name": "Exam Rank 02", "track": "common-core", "passed": True, "attempts": 2, "best": 100,
                                "days_to_pass": 14, "tries": [{"date": "2024-11-01", "mark": 0, "passed": False},
                                                              {"date": "2024-11-15", "mark": 100, "passed": True}]}]


def test_pace_sums_xp_by_month_cumulatively_and_counts_down_the_blackhole():
    projects = [project("Libft", [], xp=462, marked="2024-10-03 10:00"), project("ft_printf", [], xp=882, marked="2024-10-20 10:00"),
                project("minitalk", [], xp=1142, marked="2025-01-08 10:00"), project("fail", [], validated=False, xp=0, marked="2025-01-09 10:00")]
    cursus = {"name": "42cursus", "begin": "2024-09-16 09:42", "blackholed": "2026-11-17 09:00"}
    p = pace(projects, cursus, NOW)
    # every month from the first validation to today, empty ones at 0, so the axis is time and the total never jumps
    assert [m["month"] for m in p["months"]][:4] == ["2024-10", "2024-11", "2024-12", "2025-01"] and p["months"][-1]["month"] == "2026-10"
    assert p["months"][0] == {"month": "2024-10", "xp": 1344, "validated": 2, "cumulative": 1344}
    assert p["months"][1] == {"month": "2024-11", "xp": 0, "validated": 0, "cumulative": 1344}
    assert p["months"][3] == {"month": "2025-01", "xp": 1142, "validated": 1, "cumulative": 2486}
    assert p["months"][-1]["cumulative"] == 2486 and len(p["months"]) == 25
    assert p["blackhole_days"] == 29
    assert p["months_since_kickoff"] == 25
    assert pace(projects, {**cursus, "blackholed": None}, NOW)["blackhole_days"] is None


def ev(project, mark, outstanding=False, duration=30, lead=24.0, begin="2025-01-01 10:00"):
    return {"project": project, "mark": mark, "outstanding": outstanding, "duration_min": duration, "lead_h": lead,
            "begin": begin, "status": "done"}


def test_evaluation_depth_per_project_durations_and_the_outstanding_streak():
    received = [ev("minishell", 100, True, 40, 48.0, "2025-01-01 10:00"), ev("minishell", 125, True, 20, 2.0, "2025-01-02 10:00"),
                ev("cub3d", 80, False, 30, 24.0, "2025-02-01 10:00"), ev("cub3d", 100, True, 30, 24.0, "2025-02-02 10:00")]
    given = [ev("libft", 90, False, 15, 12.0)]
    d = evaluation_depth(received, given)
    assert d["projects"][0] == {"project": "minishell", "received": 2, "received_avg": 112.5, "received_outstanding": 2,
                                "given": 0, "given_avg": None}
    assert d["received_duration"] == {"avg": 30.0, "median": 30.0} and d["given_duration"] == {"avg": 15.0, "median": 15.0}
    assert d["received_lead_h"] == 24.0
    assert d["outstanding_streak"] == 2


def test_promo_standing_is_a_percentile_and_a_histogram_without_names():
    s = promo_standing([3.2, 5.5, 8.1, 8.9, 12.0, 16.9], 16.9)
    assert s == {"size": 6, "rank": 1, "percentile": 100.0, "median": 8.5,
                 "histogram": [{"level": 3, "count": 1}, {"level": 5, "count": 1}, {"level": 8, "count": 2},
                               {"level": 12, "count": 1}, {"level": 16, "count": 1}], "mine": 16.9}
    assert promo_standing([], 4.0) is None


def test_coalition_standings_rank_by_score_and_mark_mine():
    bloc = {"coalitions": [{"id": 1, "name": "A", "color": "#111111", "score": 300}, {"id": 2, "name": "B", "color": "#222222", "score": 900},
                           {"id": 3, "name": "C", "color": "#333333", "score": 500}]}
    assert coalition_standings(bloc, 3) == [{"name": "B", "color": "#222222", "score": 900, "rank": 1, "mine": False},
                                            {"name": "C", "color": "#333333", "score": 500, "rank": 2, "mine": True},
                                            {"name": "A", "color": "#111111", "score": 300, "rank": 3, "mine": False}]
    assert coalition_standings(None, 3) == []


def test_contact_network_links_contacts_who_evaluated_each_other():
    contacts = [{"login": "ana", "group": "rank-05"}, {"login": "bob", "group": "outer-core"}, {"login": "cyd", "group": "rank-04"}]
    given_by = {"ana": [{"correcteds": [{"login": "bob"}]}, {"correcteds": [{"login": "bob"}, {"login": "zed"}]}],
                "bob": [{"correcteds": [{"login": "me"}]}, {"correcteds": [{"login": "cyd"}]}],
                "cyd": [{"correcteds": "invisible"}]}
    net = contact_network("me", contacts, given_by)
    assert net["nodes"] == [{"login": "me", "group": "me"}, {"login": "ana", "group": "rank-05"},
                            {"login": "bob", "group": "outer-core"}, {"login": "cyd", "group": "rank-04"}]
    assert net["links"] == [{"source": "ana", "target": "bob", "count": 2}, {"source": "bob", "target": "me", "count": 1},
                            {"source": "bob", "target": "cyd", "count": 1}]


def test_skill_sets_follow_the_intra_order_with_every_skill_of_the_cursus():
    from core42.insights import SKILLS, skill_sets
    cursus_users = [{"cursus": {"name": "C Piscine"}, "skills": [{"name": "Unix", "level": 2.5}, {"name": "Rigor", "level": 1.0}]},
                    {"cursus": {"name": "42cursus"}, "skills": [{"name": "Web", "level": 7.85}, {"name": "Brand new skill", "level": 1.0}]}]
    sets = skill_sets(cursus_users)
    assert [s["name"] for s in sets["C Piscine"]] == SKILLS["C Piscine"]
    assert dict((s["name"], s["level"]) for s in sets["C Piscine"])["Unix"] == 2.5
    assert dict((s["name"], s["level"]) for s in sets["C Piscine"])["Algorithms & AI"] == 0
    assert [s["name"] for s in sets["42cursus"]][:len(SKILLS["42cursus"])] == SKILLS["42cursus"]
    assert sets["42cursus"][-1] == {"name": "Brand new skill", "level": 1.0}  # unknown skills are kept, at the end
    assert len(SKILLS["42cursus"]) == 20 and len(SKILLS["C Piscine"]) == 6


def test_analyze_adds_the_extra_views():
    import json
    from pathlib import Path
    from core42.analysis import analyze
    d = json.loads((Path(__file__).resolve().parents[2] / "web" / "tests" / "fixtures" / "42.json").read_text())
    d.update({"people": d.get("people", []), "corrector_sessions": {}, "feedbacks": {}})  # set by both pipelines
    report = analyze(d, "all")
    assert report["profile"]["campus_current"] == "Madrid"
    assert [c["name"] for c in report["campuses"]][0] == "Madrid"
    assert set(report["insights"]) == {"teammates", "exams", "pace", "evaluations"}
    assert set(report["extras"]["skills_by_cursus"]) == {"42cursus", "C Piscine"}
    assert all("group" in p for p in report["projects"])
    assert report["coalition_points"]["total"] == 6900 and report["logtime_bonus"]["last"]["80"].startswith("2026-10-07")
    assert "coalition_points" not in analyze({k: v for k, v in d.items() if k != "coalition_scores"}, "all")  # older reports


def test_coalition_points_follow_the_period_but_the_bonus_does_not():
    import json
    from pathlib import Path
    from core42.analysis import analyze
    d = json.loads((Path(__file__).resolve().parents[2] / "web" / "tests" / "fixtures" / "42.json").read_text())
    d.update({"people": d.get("people", []), "corrector_sessions": {}, "feedbacks": {}})
    piscine = analyze(d, "piscine")
    assert piscine["coalition_points"]["total"] == 0 and piscine["logtime_bonus"]["last"]["50"].startswith("2026-10-04")


def _score(at, kind, value, calc=1):
    return {"created_at": at, "scoreable_type": kind, "value": value, "calculation_id": calc}


def test_coalition_points_sum_by_source_and_by_month_in_madrid_time():
    from core42.insights import coalition_points
    scores = [_score("2026-08-31T22:30:00Z", "ScaleTeam", 250), _score("2026-09-03T10:00:00Z", "ProjectsUser", 840, 3),
              _score("2026-10-04T22:24:00Z", "Location", 500, 7), _score("2026-10-07T08:24:00Z", "Location", 1000, 20),
              _score("2026-10-08T07:52:00Z", "Team", 2000, 4), _score("2026-10-09T07:52:00Z", "Weird", 5, 99), _score("2026-10-09T08:00:00Z", "Transaction", 7, 8)]
    p = coalition_points(scores)
    assert p["total"] == 4602 and p["count"] == 7
    assert [(s["key"], s["points"], s["count"]) for s in p["sources"]] == [
        ("exams", 2000, 1), ("logtime_80", 1000, 1), ("projects", 840, 1), ("logtime_50", 500, 1), ("evaluations", 250, 1), ("wallet", 7, 1),
        ("other", 5, 1)]
    assert p["months"] == [{"month": "2026-09", "logtime": 0, "other": 1090}, {"month": "2026-10", "logtime": 1500, "other": 2012}]
    assert [b["at"][:10] for b in p["bonuses"]] == ["2026-10-07", "2026-10-04"] and p["bonuses"][0]["hours"] == 80
    assert coalition_points(None) is None and coalition_points([])["months"] == []


def _loc(b, e):
    return {"begin_at": b, "end_at": e}


def test_bonus_window_keeps_the_last_seven_days_merged_and_when_each_bonus_was_last_given():
    from core42.insights import bonus_window
    locs = [_loc("2026-10-10T08:00:00Z", "2026-10-10T20:00:00Z"),  # older than 7 days: dropped
            _loc("2026-10-11T06:00:00Z", "2026-10-11T14:00:00Z"),  # cut at the window's start
            _loc("2026-10-15T08:00:00Z", "2026-10-15T12:00:00Z"), _loc("2026-10-15T11:00:00Z", "2026-10-15T13:00:00Z"),
            _loc("2026-10-18T10:00:00Z", None)]
    scores = [_score("2026-10-04T22:24:00Z", "Location", 500, 7), _score("2026-10-12T15:33:00Z", "Location", 500, 7),
              _score("2026-10-07T08:24:00Z", "Location", 1000, 20), _score("2026-10-17T08:00:00Z", "ScaleTeam", 250)]
    w = bonus_window(locs, scores, NOW)
    assert w == {"at": "2026-10-18T12:00:00+00:00", "open": True,
                 "sessions": [["2026-10-11T12:00:00+00:00", "2026-10-11T14:00:00+00:00"], ["2026-10-15T08:00:00+00:00", "2026-10-15T13:00:00+00:00"],
                              ["2026-10-18T10:00:00+00:00", "2026-10-18T12:00:00+00:00"]],
                 "last": {"50": "2026-10-12T15:33:00Z", "80": "2026-10-07T08:24:00Z"}}


def test_logtime_bonus_counts_the_rolling_week_waits_out_the_cooldown_and_forecasts_the_logout():
    from datetime import timedelta
    from core42.insights import logtime_bonus
    # 45 h in the window, logged in since 10:00; 50 h given 6 days ago, 80 h never
    w = {"at": NOW.isoformat(), "open": True, "last": {"50": (NOW - timedelta(days=6)).isoformat(), "80": None},
         "sessions": [[(NOW - timedelta(days=3)).isoformat(), (NOW - timedelta(days=3) + timedelta(hours=43)).isoformat()],
                      [(NOW - timedelta(hours=2)).isoformat(), NOW.isoformat()]]}
    t50, t80 = logtime_bonus(w, NOW)
    assert (t50["hours"], t50["points"], t50["window_h"], t50["need_h"]) == (50, 500, 45.0, 5.0)
    assert t50["state"] == "cooldown" and t50["from"] == (NOW + timedelta(days=1)).isoformat()
    assert t50["until"] == t50["from"]  # 5 h are reached before the cooldown ends: the logout waits for it
    assert t80["state"] == "short" and t80["need_h"] == 35.0 and t80["until"] == (NOW + timedelta(hours=35)).isoformat()
    # an hour later, still logged in (assumed): the window grew by an hour
    later = logtime_bonus(w, NOW + timedelta(hours=1))[1]
    assert later["window_h"] == 46.0 and later["until"] == t80["until"]


def test_logtime_bonus_is_ready_when_the_window_is_over_and_the_old_hours_drop_out():
    from datetime import timedelta
    from core42.insights import logtime_bonus
    # 52 h in the window, logged out: the 50 h one is due at the next logout; 80 h has to make up what leaves the window
    w = {"at": NOW.isoformat(), "open": False, "last": {"50": None, "80": None},
         "sessions": [[(NOW - timedelta(days=7)).isoformat(), (NOW - timedelta(days=6)).isoformat()],
                      [(NOW - timedelta(days=5)).isoformat(), (NOW - timedelta(days=5) + timedelta(hours=28)).isoformat()]]}
    t50, t80 = logtime_bonus(w, NOW)
    assert t50["window_h"] == 52.0 and t50["state"] == "ready" and t50["until"] == NOW.isoformat()
    # logging in now: the first 24 h leave the window while they are made up, the 28 h later on too, so it takes 80 h
    assert t80["state"] == "short" and t80["need_h"] == 28.0 and t80["until"] == (NOW + timedelta(hours=80)).isoformat()
