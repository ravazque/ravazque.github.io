"""Community, technical domains, rhythm and the portfolio, computed from the report."""
from app.dash import extra


def test_longest_streak_counts_consecutive_days_with_time():
    days = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-05", "2026-01-06"]
    assert extra.streak(days, [1, 2, 0.5, 3, 1]) == 3
    assert extra.streak(days, [1, 0, 1, 1, 1]) == 2
    assert extra.streak([], []) == 0


def test_the_day_splits_into_morning_afternoon_and_night():
    heat = [[0] * 24 for _ in range(7)]
    heat[0][9], heat[1][15], heat[2][23], heat[3][2] = 2, 1, 1, 0
    assert extra.day_split(heat) == {"morning": 50, "afternoon": 25, "night": 25}


def test_community_counts_time_people_and_rating():
    given = [{"duration_min": 30, "correcteds": [{"login": "a"}, {"login": "b"}], "fb_rating": 5},
             {"duration_min": 90, "correcteds": [{"login": "a"}], "fb_rating": 4}]
    c = extra.community(given, [{"corrector": {"login": "x"}}, {"corrector": {"login": "x"}}])
    assert (c["hours"], c["people"], c["correctors"], c["rating"]) == (2.0, 2, 1, 4.5)


def test_domains_sum_validated_projects_by_area():
    projects = [{"name": "red-tetris", "validated": True, "xp_earned": 100}, {"name": "camagru", "validated": False, "xp_earned": 0},
                {"name": "dslr", "validated": True, "xp_earned": 50}]
    d = {x["key"]: x for x in extra.domains(projects)}
    assert d["web"]["xp"] == 100 and d["web"]["projects"] == ["red-tetris"] and d["ai"]["xp"] == 50
    assert "mobile" not in d


def test_resilience_counts_projects_validated_after_failing():
    projects = [{"validated": True, "failed_attempts": 1}, {"validated": True, "failed_attempts": 0}, {"validated": False, "failed_attempts": 2}]
    assert extra.resilience(projects) == 1
