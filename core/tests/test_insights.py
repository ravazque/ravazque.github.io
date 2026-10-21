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
        {"login": "ana", "name": "Ana A", "teams": 3, "projects": ["minishell", "cub3d", "webserv"]},
        {"login": "bob", "name": "Bob B", "teams": 2, "projects": ["webserv"]}]


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
    assert p["months"] == [{"month": "2024-10", "xp": 1344, "validated": 2, "cumulative": 1344},
                           {"month": "2025-01", "xp": 1142, "validated": 1, "cumulative": 2486}]
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
