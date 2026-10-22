"""Astra Victoris: RNCP requirements from validated projects, XP, teams, events and level; The Gatekeeper from
evaluations and hours."""
from app.dash import astra
from app.dash.fmt import Fmt

F = Fmt("en")


def project(name, validated=True, xp=1000, team=False):
    return {"name": name, "validated": validated, "xp_earned": xp,
            "attempts": [{"validated": validated, "members": ["mate"] if team else []}]}


def test_tagged_projects_count_only_when_validated_and_match_names_case_insensitively():
    projects = [project("Red-Tetris", xp=20000), project("camagru", validated=False), project("unrelated")]
    count = astra.requirement(F, {"projects": "web", "n": 2}, projects, {})
    xp = astra.requirement(F, {"xp": "web", "n": 15000}, projects, {})
    assert (count["have"], count["met"], count["list"]) == (1, False, ["Red-Tetris"])
    assert (xp["have"], xp["met"]) == (20000, True)


def test_group_events_and_level():
    projects = [project("a", team=True), project("b", team=True), project("c")]
    extras = {"events": [{}] * 12, "cursus": [{"name": "42cursus", "level": 17.2}]}
    assert astra.requirement(F, {"group": 2}, projects, extras)["met"]
    assert astra.requirement(F, {"events": 15}, projects, extras)["have"] == 12
    assert astra.requirement(F, {"level": 17}, projects, extras)["met"]


def test_one_full_option_is_enough_for_a_title():
    names = {"suite": "rt", "web": ["red-tetris", "camagru"], "mobile": ["swifty-companion", "ft_hangouts"]}
    projects = [project("rt", team=True), project("matcha", team=True), *[project(n, xp=12000) for n in names["web"] + names["mobile"]],
                project("Work Experience I"), project("Work Experience II")]
    extras = {"events": [{}] * 10, "cursus": [{"name": "42cursus", "level": 17}]}
    result = astra.rncp(F, "rncp6", projects, extras)
    assert result["met"] and result["options"][0]["met"] and not result["options"][1]["met"]


def test_gatekeeper_needs_one_evaluation_path_and_the_hours():
    def data(given, hours):
        return {"periods": {"student": {"given": given}, "all": {"logtime": {"total_hours": hours}}}}
    outer = [{"project": "x", "slug": "ft_ping", "fb_rating": 5}] * 50
    common = [{"project": "libft", "slug": "libft", "fb_rating": 4}] * 150
    assert astra.gatekeeper(data(outer, 2000))["met"]
    assert not astra.gatekeeper(data(outer, 1999))["met"]
    low = astra.gatekeeper(data(common, 2500))
    assert low["outer"] == 0 and not low["evals_met"]
    assert astra.gatekeeper(data([{**e, "fb_rating": 5} for e in common], 2500))["met"]


def test_every_goal_has_its_drawing():
    for g in astra.GOALS:
        svg = str(astra.hexagon(g, g))
        assert svg.startswith("<svg") and 'class="hex-out"' in svg and "<path" in svg + "<circle"
