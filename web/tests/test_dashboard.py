import re

import pytest

from app.dash import charts, graphs
from app.dash.fmt import Fmt
from app.extract import extract
from app.store import Store
from test_extract import UID, FakeApi

PAGES = {"/app": "home", "/app/projects": "projects", "/app/evaluations": "evaluations", "/app/people": "people", "/app/campus": "campus"}
SECTIONS = {"/app": ["profile", "home-kpis", "rhythm", "pace", "skills", "coal-points", "activity"], "/app/projects": ["projects-table", "exams", "domains", "timeline"],
            "/app/evaluations": ["community", "over-time", "when", "correction-stats", "feedback", "points", "log"],
            "/app/people": ["who", "connections", "circle", "teammates"], "/app/campus": ["seats", "days", "sessions", "where"]}
INLINE_SCRIPT = re.compile(r"<script\b(?![^>]*\bsrc=)[^>]*>", re.IGNORECASE)


async def _noop(_):
    pass


@pytest.fixture
async def report(memory, settings):
    data = await extract(FakeApi(), UID, _noop)
    store = Store(memory, settings)
    await store.save_report(7, data)
    await store.set_status(7, state="done", progress=1, last="2026-10-21T10:00:00+00:00")
    return data


@pytest.mark.parametrize("path", PAGES)
async def test_dashboard_pages_need_a_session(client, path):
    r = await client.get(path)
    assert r.status_code == 303 and r.headers["location"] == "/"


@pytest.mark.parametrize("path", PAGES)
async def test_every_page_is_rendered_on_the_server(signed_in, report, path):
    r = await signed_in.get(path)
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert f'data-page="web-{PAGES[path]}"' in r.text
    for sid in SECTIONS[path]:
        assert f'<section id="{sid}"' in r.text and f'href="#{sid}"' in r.text
    for asset in ("/ui.css", "/shared/report.css", "/static/dash.css", "/static/vendor/htmx.min.js", "/static/dash.js"):
        assert asset in r.text
    for gone in ("/shared/report.js", "chart.umd", "d3.min.js", "/static/app.js"):
        assert gone not in r.text
    assert "{{" not in r.text and not INLINE_SCRIPT.search(r.text) and "onerror=" not in r.text
    for href in ('href="/about"', 'href="/privacy"', 'href="https://github.com/example/logbook/issues/new/choose"'):
        assert href in r.text


async def test_the_csrf_token_rides_on_htmx_requests_and_forms(signed_in, report):
    r = await signed_in.get("/app")
    token = signed_in.csrf["X-CSRF-Token"]
    assert f'"X-CSRF-Token": "{token}"' in r.text and f'name="csrf" value="{token}"' in r.text


async def test_the_page_carries_the_coalition_colour(signed_in, report):
    assert 'data-coalition="#3E7BC8"' in (await signed_in.get("/app")).text


async def test_the_period_comes_from_the_query_and_the_links_keep_it(signed_in, report):
    r = await signed_in.get("/app/campus?period=all")
    assert 'href="/app/campus?period=all" role="button" aria-pressed="true"' in r.text
    assert 'href="/app/people?period=all"' in r.text
    bad = await signed_in.get("/app/campus?period=nope")
    assert bad.status_code == 200 and f'?period={report["default_period"]}" role="button" aria-pressed="true"' in bad.text


async def test_the_projects_table_filters_on_the_server(signed_in, report):
    name = report["periods"]["all"]["projects"][0]["name"]
    hit = await signed_in.get("/app/projects", params={"track": "all", "q": name})
    miss = await signed_in.get("/app/projects", params={"track": "all", "q": "no-such-project-xyz"})
    assert name in hit.text.split('id="projects-table-results"')[1]
    assert "projects_table.none" not in miss.text and name not in miss.text.split('id="projects-table-results"')[1].split("</table>")[0]


async def test_the_projects_csv_follows_the_filters(signed_in, report):
    r = await signed_in.get("/app/projects.csv", params={"track": "all"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert 'filename="projects-all.csv"' in r.headers["content-disposition"]
    assert r.text.count("\n") == 1 + len(report["periods"]["all"]["projects"])


async def test_the_log_search_and_a_bubble_link_meet(signed_in, report):
    login = report["periods"][report["default_period"]]["received"][0]["corrector"]["login"]
    people = await signed_in.get("/app/people")
    assert f"q={login}" in people.text
    log = await signed_in.get("/app/evaluations", params={"q": login})
    rows = log.text.split('id="log-results"')[1]
    assert login in rows


async def test_switches_are_links_that_swap_only_their_section(signed_in, report):
    r = await signed_in.get("/app/people?mode=mix")
    assert 'hx-target="#connections"' in r.text and 'aria-pressed="true">' in r.text
    assert (await signed_in.get("/app/people?mode=nonsense")).status_code == 200


async def test_with_nothing_stored_the_boot_screen_starts_the_extraction(signed_in, jobs):
    r = await signed_in.get("/app?fresh=1")
    assert r.status_code == 200 and 'id="boot"' in r.text and 'hx-get="/app/boot"' in r.text
    assert jobs.enqueued == ["extract_job"]


async def test_the_boot_poll_reloads_once_the_report_exists(signed_in, report):
    r = await signed_in.get("/app/boot")
    assert r.headers.get("hx-refresh") == "true"


async def test_the_sync_bar_reloads_the_page_when_the_extraction_ends(signed_in, report):
    r = await signed_in.get("/app/sync")
    assert r.headers.get("hx-refresh") == "true" and 'id="sync"' in r.text


async def test_refresh_needs_the_csrf_token(signed_in, report):
    assert (await signed_in.post("/app/refresh", data={"next": "/app"})).status_code == 403
    r = await signed_in.post("/app/refresh", data={"csrf": signed_in.csrf["X-CSRF-Token"], "next": "https://evil.example/"})
    assert r.status_code == 303 and r.headers["location"] == "/"


async def test_delete_asks_first_and_then_removes_everything(signed_in, report, memory, settings):
    page = await signed_in.get("/app/delete")
    assert 'action="/app/delete"' in page.text
    assert (await signed_in.post("/app/delete")).status_code == 403
    r = await signed_in.post("/app/delete", data={"csrf": signed_in.csrf["X-CSRF-Token"]})
    assert r.status_code == 303 and r.headers["location"] == "/"
    assert await Store(memory, settings).load_report(7) is None


async def test_publishing_is_only_offered_to_the_owner(signed_in, report):
    assert (await signed_in.get("/app/publish")).headers["location"] == "/app"
    assert 'href="/app/publish"' not in (await signed_in.get("/app")).text


async def test_old_corrections_links_land_on_evaluations(signed_in):
    r = await signed_in.get("/app/corrections")
    assert r.status_code == 301 and r.headers["location"] == "/app/evaluations"


async def test_the_language_switch_returns_to_the_same_view(client):
    r = await client.post("/lang", data={"lang": "es", "next": "/app/people?view=ring&period=all"})
    assert r.headers["location"] == "/app/people?view=ring&period=all"
    for bad in ("//evil.example/app", "https://evil.example/app", "/elsewhere"):
        assert (await client.post("/lang", data={"lang": "es", "next": bad})).headers["location"] == "/"


def test_numbers_and_dates_follow_the_language():
    en, es = Fmt("en"), Fmt("es")
    assert (en.num(1234567.891, 2), es.num(1234567.891, 2)) == ("1,234,567.89", "1.234.567,89")
    assert (en.num(1234), es.num(1234), es.num(12345)) == ("1,234", "1234", "12.345")
    assert en.num(None) == "–" and en.num(2.50, 2) == "2.5"
    assert en.plural(1, "count.days") == "1 day" and en.plural(3, "count.days") == "3 days"
    assert en.day("2026-10-02T09:00:00Z") == "2 Oct 2026" and es.day("2026-10-02") == "2 oct 2026"
    assert en.hm(3 * 3600 + 5 * 60) == "3h 05m"
    assert str(en.html("rail.now_at", seat=graphs.Markup("<b>x</b>"))).count("<b>x</b>") == 1
    assert "<script>" not in str(en.html("rail.now_at", seat="<script>"))


def test_axis_tops_are_round():
    assert [charts.nice_max(v) for v in (0, 0.7, 3, 7, 13, 240, 1001)] == [1, 1, 5, 10, 20, 250, 2000]


def test_charts_escape_labels_and_summarise_for_screen_readers():
    f = Fmt("en")
    html = str(charts.vbars(f, ["<b>"], [("s", [3], charts.S1)], label="L"))
    assert "<b>" not in html.replace("<b class", "") and 'aria-label="L: &lt;b&gt; 3"' in html
    assert "note chart-empty" in str(charts.vbars(f, ["a"], [("s", [0], charts.S1)], label="L", empty_text="none"))


def test_bubbles_never_overlap():
    people = [{"login": f"p{i}", "group": "rank-0" + str(i % 3), "received": 1 + i % 7, "given": i % 4} for i in range(40)]
    svg = graphs.bubbles(Fmt("en"), people, "mix", width=960, height=520, href=lambda login: "#")
    circles = [(float(x), float(y), float(r)) for x, y, r in re.findall(r'translate\(([\d.]+),([\d.]+)\)"[^>]*>(?:<title>[^<]*</title>)?<circle class="core" r="([\d.]+)"', svg)]
    assert len(circles) == sum(1 for p in people for d in ("received", "given") if p[d])
    for i, (x, y, r) in enumerate(circles):
        for x2, y2, r2 in circles[i + 1:]:
            assert (x - x2) ** 2 + (y - y2) ** 2 >= (r + r2) ** 2 - 1


@pytest.mark.parametrize("path", PAGES)
async def test_no_markup_is_shown_as_text(signed_in, report, path):
    text = (await signed_in.get(path)).text
    for leaked in ("&lt;span", "&lt;i ", "&lt;b&gt;", "&lt;a ", "&lt;svg", "&lt;br"):
        assert leaked not in text


async def test_an_outdated_acceptance_asks_for_the_new_policy_first(signed_in, report, memory):
    from app import consent
    for k in await memory.keys("consent:*"):
        await memory.delete(k)
    page = await signed_in.get("/app/people?view=ring")
    assert 'action="/app/consent"' in page.text and 'name="accept"' in page.text and '<section id="who"' not in page.text
    token = signed_in.csrf["X-CSRF-Token"]
    assert (await signed_in.post("/app/consent", data={"next": "/app"})).status_code == 403
    still = await signed_in.post("/app/consent", data={"csrf": token, "next": "/app"})
    assert still.status_code == 303 and still.headers["location"].startswith("/app/consent")
    r = await signed_in.post("/app/consent", data={"csrf": token, "accept": "1", "next": "/app/people?view=ring"})
    assert r.status_code == 303 and r.headers["location"] == "/app/people?view=ring"
    assert '<section id="who"' in (await signed_in.get("/app/people")).text
    assert consent.VERSION >= 1


async def test_opted_out_students_never_appear(app, signed_in, report):
    from dataclasses import replace
    hidden = report["periods"][report["default_period"]]["people"][0]["login"]
    app.state.settings = replace(app.state.settings, optout_logins=frozenset({hidden}))
    for path in PAGES:
        text = (await signed_in.get(path)).text
        assert hidden not in text, path
    assert "Hidden" in (await signed_in.get("/app/people")).text


async def test_the_privacy_policy_names_the_controller_version_and_rights(client):
    from app import consent
    text = (await client.get("/privacy", headers={"Accept-Language": "en"})).text
    for s in ("Owner Example (owner)", "owner@example.invalid", "AEPD", "Art. 6.1.a", "Art. 6.1.f", f"Version {consent.VERSION}",
              "want to be excluded", "not affiliated with or endorsed by 42", "2 years after your last sign-in"):
        assert s in text, s
    es = (await client.get("/privacy", headers={"Accept-Language": "es"})).text
    assert "AEPD" in es and f"Versión {consent.VERSION}" in es


async def test_the_portfolio_lists_validated_projects_without_other_people(signed_in, report):
    r = await signed_in.get("/app/portfolio.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "portfolio-ana.csv" in r.headers["content-disposition"]
    validated = [p for p in report["periods"]["all"]["projects"] if p.get("validated")]
    assert r.text.count("\n") == 1 + len(validated)
    for p in report["periods"]["all"]["people"]:
        assert p["login"] not in r.text


def test_the_circle_draws_one_way_and_two_way_arrows():
    net = {"nodes": [{"login": "me", "group": "me"}, {"login": "a", "group": "rank-01"}, {"login": "b", "group": "rank-02"}],
           "links": [{"source": "a", "target": "b", "count": 2}, {"source": "b", "target": "a", "count": 1}, {"source": "a", "target": "me", "count": 1}]}
    svg = graphs.ring(Fmt("en"), net, width=400, height=400, compact=False, uid="t")
    arrows = svg.split('<g class="net-arrows">')[1].split("</g>")[0]
    both = re.search(r'<path[^>]*data-a="a" data-b="b"[^>]*>', arrows).group(0)
    one = re.search(r'<path[^>]*data-a="a" data-b="me"[^>]*>', arrows).group(0)
    assert "marker" not in svg.split('<g class="net-links">')[1].split("</g>")[0]  # the visible chords carry no arrowheads
    assert 'marker-start="url(#arr-t)"' in both and 'marker-end="url(#arr-t)"' in both
    assert 'marker-end="url(#arr-t)"' in one and "marker-start" not in one
    assert svg.count('<marker id="arr-t"') == 1


def test_the_circle_colours_your_own_chords_by_direction():
    net = {"nodes": [{"login": "me", "group": "me"}, {"login": "a", "group": "rank-01"}, {"login": "b", "group": "blackholed"}, {"login": "c", "group": "rank-01"}],
           "links": [{"source": "a", "target": "me", "count": 1}, {"source": "me", "target": "b", "count": 1},
                     {"source": "me", "target": "c", "count": 1}, {"source": "c", "target": "me", "count": 1}]}
    svg = graphs.ring(Fmt("en"), net, width=400, height=400, compact=False, uid="t")
    links = svg.split('<g class="net-links">')[1].split("</g>")[0]
    dirs = {a if b == "me" else b: d for a, b, d in re.findall(r'data-a="(\w+)" data-b="(\w+)" data-dir="(\w+)"', links)}
    assert dirs == {"a": "in", "b": "out", "c": "both"}
    assert 'class="net-node dead"' in svg


def test_the_circle_keeps_the_period_s_links(report):
    from app.dash.views import Page, people
    every = report["network"]["all"]
    gone, other = [n for n in every["nodes"] if n["group"] != "me"][:2]
    every = {"nodes": [{**n, "group": "blackholed"} if n is gone else n for n in every["nodes"]],
             "links": every["links"] + [{"source": gone["login"], "target": other["login"], "count": 1}]}
    data = {**report, "network": {"all": every, "student": {"nodes": [], "links": []}, "piscine": every}}
    circle = lambda p: next(s for s in people(Page(Fmt("en"), data, "people", {"period": p})) if s["id"] == "circle")  # noqa: E731
    assert circle("student")["wide"] == "" and circle("all")["wide"] != ""
    side = str(circle("all")["side"])
    assert 'class="net-key"' in side and "Blackholed" in side and re.search(r"Blackholed</span><b>1</b>", side)
    assert re.search(r"Both ways</span><b>\d+</b>", side)


def test_the_user_s_own_evaluations_draw_their_links():
    from app.dash.views import circle_links
    net = {"nodes": [{"login": "me", "group": "me"}, {"login": "a", "group": "x"}, {"login": "b", "group": "x"}],
           "links": [{"source": "a", "target": "me", "count": 9}, {"source": "a", "target": "b", "count": 1}]}
    given = [{"correcteds": [{"login": "a"}]}, {"correcteds": [{"login": "a"}, {"login": "zz"}]}]
    received = [{"corrector": {"login": "a"}}, {"corrector": {"login": "b"}}]
    links = {(l["source"], l["target"]): l["count"] for l in circle_links(net, "me", given, received)["links"]}
    assert links == {("a", "b"): 1, ("me", "a"): 2, ("a", "me"): 1, ("b", "me"): 1}


async def test_the_circle_has_its_own_section(signed_in, report):
    text = (await signed_in.get("/app/people")).text
    assert '<section id="circle"' in text and 'href="#circle"' in text


@pytest.mark.parametrize("path", PAGES)
async def test_every_tooltip_also_works_without_javascript(signed_in, report, path):
    text = (await signed_in.get(path)).text
    tags = list(re.finditer(r'<(\w+)\b[^>]*\bdata-tip="[^"]*"[^>]*>', text))
    for m in tags:
        if m.group(1) in ("circle", "a", "g", "path"):
            assert text[m.end():m.end() + 7] == "<title>", m.group(0)[:80]
        else:
            assert ' title="' in m.group(0), m.group(0)[:80]


def test_the_logtime_bonus_says_what_is_missing_and_when(report):
    from datetime import datetime, timedelta, timezone
    from app.dash.views import Page, coalition_points
    data = report
    D = data["periods"]["student"]
    now = datetime(2026, 10, 24, 20, 0, tzinfo=timezone.utc)
    D = {**D, "logtime_bonus": {"at": now.isoformat(), "open": True, "last": {"50": "2026-10-22T15:33:00Z", "80": "2026-10-07T08:24:00Z"},
                                "sessions": [[(now - timedelta(hours=56)).isoformat(), now.isoformat()]]}}
    pg = Page(Fmt("en"), {**data, "periods": {**data["periods"], "student": D}}, "home", {"period": "student"})
    s = coalition_points(pg, now)
    flat = re.sub(r"</?span[^>]*>", ""," ".join(str(x) for _, v, subs in s["kpis"] for x in [v, *subs]))
    assert "56 h" in s["kpis"][0][1] or "56<small>" in s["kpis"][0][1]
    assert "Waiting" in flat and "available again from 29 Oct 2026, 16:33" in flat  # 50 h: 7 days after the last one
    assert "24<small> h to go" in flat and "log out from 25 Oct 2026, 21:00" in flat  # 80 h: 24 h more, Madrid time
    assert "Exams passed" in s["sources"] and "6,900 points in 5 awards" in s["total"]


async def test_home_opens_on_six_equal_modules_with_the_bonus_live(signed_in, report):
    text = (await signed_in.get("/app")).text
    keys = re.findall(r'data-module="([a-z]+)"', text)
    assert keys == ["level", "projects", "evals", "coalition", "bonus", "hours"]
    assert re.search(r'data-module="bonus"[^>]*class="[^"]*live', text) or re.search(r'class="[^"]*live[^"]*"[^>]*data-module="bonus"', text)
    assert 'class="rail"' not in text and "rail.figure_aria" not in text  # no side rail, hours are not the lead


async def test_the_page_head_names_the_page_and_keeps_the_period_switch(signed_in, report):
    text = (await signed_in.get("/app/projects?period=all")).text
    assert re.search(r'<h1[^>]*>\s*Projects\s*</h1>', text)
    assert 'aria-label="Period"' in text or 'class="periods"' in text


async def test_only_home_carries_the_identity_card(signed_in, report):
    home = (await signed_in.get("/app")).text
    assert 'class="id-card"' in home and "wallet" in home.lower() and "evaluation points" in home.lower()
    profile = home[home.index('<section id="profile"'):home.index('<section id="home-kpis"')]  # the first section, before the figures
    assert 'class="id-card"' in profile and "Piscine" in profile and "42cursus since" in profile
    head = home[home.index('<header class="page-head'):home.index("</header>", home.index('<header class="page-head'))]
    assert "id-card" not in head
    other = (await signed_in.get("/app/projects")).text
    assert 'class="id-card"' not in other and 'class="who"' not in other


async def test_no_profile_shows_a_blackhole(signed_in, report):
    from app.dash.views import Page, home
    D = report["periods"]["all"]
    cursus = [{**c, "grade": "Learner"} for c in D["extras"]["cursus"]]  # a Common Core student this time
    data = {**report, "periods": {**report["periods"], "all": {**D, "extras": {**D["extras"], "cursus": cursus}}}}
    text = " ".join(str(s) for s in home(Page(Fmt("en"), data, "home", {"period": "all"})))
    assert "Blackhole" not in text and "none ahead" not in text and "days left" not in text
    assert "Blackhole" not in (await signed_in.get("/app")).text


def test_when_you_work_names_the_part_of_the_day_with_a_split_bar(report):
    from app.dash.views import Page, home
    rhythm = next(s for s in home(Page(Fmt("en"), report, "home", {"period": "all"})) if s["id"] == "rhythm")
    k, v, subs = next(x for x in rhythm["kpis"] if x[0] == "When you work")
    assert v in ("Morning", "Afternoon", "Night") and "%" not in str(v)
    assert 'class="split"' in str(subs[0]) and "morning" in str(subs[1])


def test_sections_with_their_own_switch_start_on_the_period(report):
    from app.dash.views import Page, home, project_filters
    for period, track, cursus in (("piscine", "piscine", "C Piscine"), ("student", "student", "42cursus"), ("all", "all", "42cursus")):
        assert project_filters(Page(Fmt("en"), report, "projects", {"period": period}))["track"] == track
        skills = next(s for s in home(Page(Fmt("en"), report, "home", {"period": period})) if s["id"] == "skills")
        assert f'aria-pressed="true">{"Piscine" if cursus == "C Piscine" else "Student"}<' in str(skills["switches"][0])
    assert project_filters(Page(Fmt("en"), report, "projects", {"period": "piscine", "track": "student"}))["track"] == "student"


def test_the_projects_table_leaves_exams_to_their_own_section(report):
    from app.dash.views import Page, projects
    D = report["periods"]["all"]
    exam = {**D["projects"][0], "name": "Exam Rank 02", "exam": True}
    data = {**report, "periods": {**report["periods"], "all": {**D, "projects": D["projects"] + [exam]}}}
    sections = projects(Page(Fmt("en"), data, "projects", {"period": "all", "track": "all"}))
    assert [s["id"] for s in sections][:2] == ["projects-table", "exams"]
    exams = ["Exam Rank 02"]
    assert exams and not any(f">{n}<" in str(sections[0]["table"]) for n in exams)


def test_validated_projects_add_up_beside_the_retries(report):
    from app.dash.views import Page, projects
    tl = next(s for s in projects(Page(Fmt("en"), report, "projects", {"period": "all"})) if s["id"] == "timeline")
    assert "lchart" in str(tl["validated"]) or "empty" in str(tl["validated"])


def test_points_by_source_name_the_coalition_and_the_months(report):
    from app.dash.views import Page, coalition_points
    s = coalition_points(Page(Fmt("en"), report, "home", {"period": "all"}))
    months = report["periods"]["all"]["coalition_points"]["months"]
    assert report["periods"]["all"]["profile"]["coalition"]["name"] in s["total"] and f"{Fmt('en').months[int(months[0]['month'][5:7]) - 1]} {months[0]['month'][:4]}" in s["total"]


def test_each_feedback_below_the_maximum_is_broken_down_by_criterion(report):
    from app.dash.views import Page, evaluations
    fb = next(s for s in evaluations(Page(Fmt("en"), report, "evaluations", {"period": "all"})) if s["id"] == "feedback")
    low = str(fb["low"])
    if "fb-crit" in low:
        assert low.count('class="pips"') == 5 * low.count('class="fb-item"')  # overall + the four criteria
        assert "On time" in low or "Punctuality" in low


async def test_the_settings_carry_the_period_switch_for_when_the_head_is_out_of_view(signed_in, report):
    text = (await signed_in.get("/app/projects?period=all")).text
    settings = text[text.index('class="settings"'):]
    assert 'class="theme periods-copy"' in settings and "period=piscine" in settings


async def test_campuses_are_a_panel_of_activity_and_leave_every_footer(signed_in, report):
    home = (await signed_in.get("/app")).text
    assert '<section id="campuses"' not in home and home.count('data-panel="campuses"') == 1
    activity = home[home.index('<section id="activity"'):]
    assert 'data-panel="campuses"' in activity[:activity.index("</section>")]
    assert 'data-panel="campuses"' not in (await signed_in.get("/app/projects")).text


async def test_the_hours_module_follows_the_period(signed_in, report):
    for period in ("all", "piscine"):
        text = (await signed_in.get(f"/app?period={period}")).text
        m = text[text.index('data-module="hours"'):]
        hours = report["periods"][period]["logtime"]["total_seconds"] / 3600
        assert f'data-count="{round(hours, 1)}"' in m[:m.index("</article>")]


def test_the_promo_chart_has_every_level_and_says_where_you_are():
    from app.dash.views import promo_chart
    html = str(promo_chart(Fmt("en"), {"histogram": [{"level": 0, "count": 3}, {"level": 2, "count": 2}], "mine": 2.4}))
    assert html.count('class="ch-col stack"') == 3  # level 1 is empty but still on the axis
    assert "Level 2 · 2 students · you are here" in html and "Level 0 · 3 students\"" in html and "Level 1 ·" not in html  # an empty level has no bar to point at
    assert "Yours" not in html and "Students 0" not in html


def test_alumni_comes_eight_months_after_the_last_validated_project_unless_paused():
    from datetime import date
    from app.dash.views import alumni_due
    p = lambda slug, status, validated, marked, track="outer-core": {"slug": slug, "status": status, "validated": validated, "marked": marked, "track": track}  # noqa: E731
    done = [p("42cursus-ft_irc", "finished", True, "2026-03-30 12:00"), p("42cursus-ft_linear_regression", "finished", True, "2026-09-28 18:46"),
            p("music-room", "finished", False, "2026-10-01 10:00"), p("c-piscine-exam-00", "finished", True, "2026-12-01 10:00", "piscine")]
    assert alumni_due(done, "Transcender") == date(2027, 5, 28)
    assert alumni_due(done + [p("work-experience-i", "in_progress", None, None)], "Transcender") == "paused"
    assert alumni_due(done + [p("42cursus-work-experience-ii", "waiting_for_correction", None, None)], "Transcender") == "paused"
    assert alumni_due(done + [p("work-experience-i", "finished", False, "2023-04-24 10:00")], "Transcender") == date(2027, 5, 28)
    assert alumni_due(done + [p("work-experience-i-work-experience-i-duration", "in_progress", None, None)], "Transcender") == date(2027, 5, 28)
    assert alumni_due([p("x", "finished", True, "2026-06-30 10:00")], "Transcender") == date(2027, 2, 28)  # the month's last day
    assert alumni_due(done, "Alumni") is None and alumni_due(done, None) is None and alumni_due([], "Transcender") is None


async def test_transcenders_see_when_they_become_alumni(signed_in, report):
    text = (await signed_in.get("/app")).text  # the fixture's student is a Transcender, last validated in Oct 2026
    profile = text[text.index('<section id="profile"'):text.index('<section id="home-kpis"')]
    assert "Alumni by" in profile and "Jun 2027" in profile


async def test_the_latest_coalition_points_say_what_they_came_from(signed_in, report):
    text = (await signed_in.get("/app?period=all")).text
    standing = text[text.index('<section id="standing"'):]
    panel = standing[standing.index('data-panel="coal-recent"'):]
    panel = panel[:panel.index("</ol>")]
    assert panel.index("scop") < panel.index("Leaffliction") < panel.index("over 80 h")  # newest first
    assert "+3,150" in panel and "Evaluated" in panel


def test_bars_show_their_details_only_over_the_bar():
    f = Fmt("en")
    v = str(charts.vbars(f, ["a", "b"], [("s", [3, 1], charts.S1)], label="L"))
    assert 'class="ch-col" data-tip' not in v and v.count('data-tip="a · s 3"') == 1
    h = str(charts.hbars(f, ["a"], [("s", [3], charts.S1), ("t", [2], charts.S2)], label="L"))
    assert 'class="hb-row" data-tip' not in h and h.count("data-tip=") == 2


async def test_the_sync_bar_shows_only_the_progress_while_reading(signed_in, report, memory, settings):
    await Store(memory, settings).set_status(7, state="running", progress=.4)
    text = (await signed_in.get("/app/sync")).text
    assert 'class="progress"' in text and 'class="wait"' not in text
    assert re.search(r'class="visually-hidden">Reading the 42 API<', text)  # still said to screen readers


async def test_home_is_called_profile_and_opens_on_the_identity_card(signed_in, report):
    text = (await signed_in.get("/app")).text
    assert re.search(r"<h1[^>]*>\s*Profile\s*</h1>", text) and re.search(r'aria-current="page">Profile</a>', text)
    profile = text[text.index('<section id="profile"'):text.index("</section>", text.index('<section id="profile"'))]
    assert "<h2" not in profile and 'class="id-card"' in profile


async def test_campuses_carry_no_current_badge(signed_in, report):
    text = (await signed_in.get("/app")).text
    panel = text[text.index('data-panel="campuses"'):]
    assert "current" not in panel[:panel.index("</div>")]


@pytest.mark.parametrize("path", ["/app", "/app/people"])
async def test_touch_only_devices_get_the_block_on_the_app(signed_in, report, path):
    assert 'class="touch-block"' in (await signed_in.get(path)).text


def _with_seats(report):
    """The fixture report with the other side looked up for its first received and first given evaluation."""
    import copy
    data = copy.deepcopy(report)
    data["seat_days"] = 60
    for D in data["periods"].values():
        for e in D["received"][:1]:
            e.update(other_host="c1r1s1", other_host_checked=True)
            e["corrector"]["host"] = "c1r1s1"
        for e in D["given"][:1]:
            e["other_host_checked"] = True
            for c in e["correcteds"]:
                c["host"] = "c3r2s1"
    return data


def test_the_log_says_when_each_evaluation_ran_how_long_and_where_everyone_sat(report):
    from app.dash.views import Page, log_section
    data = _with_seats(report)
    for role, other in (("received", "c1r1s1"), ("given", "c3r2s1")):
        s = log_section(Page(Fmt("en"), data, "evaluations", {"period": "all", "log": role}))
        e = data["periods"]["all"][role][0]
        table = str(s["table"])
        assert f'{e["begin"]} → {e["filled"][11:]}' in table  # start and end, Madrid time
        assert other in table and "Your seat" in table and "min" in table
        assert re.search(r'<th scope="col" class="num nowrap"[^>]*><button[^>]*>Duration', table)  # not hidden on narrow screens


def test_where_shows_the_corrector_whom_you_evaluated_or_you(report):
    from app.dash.views import Page, campus
    data = _with_seats(report)
    for role, seat in (("corrector", "c1r1s1"), ("evaluated", "c3r2s1")):
        where = campus(Page(Fmt("en"), data, "campus", {"period": "all", "where": role}))[-1]
        assert seat in str(where["plan"]) and "last 60 days" in where["lede"]
    assert campus(Page(Fmt("en"), data, "campus", {"period": "all"}))[-1]["switch"].count('aria-pressed="true">You, during evaluations') == 1
    old = {k: v for k, v in report.items() if k != "seat_days"}
    plain = campus(Page(Fmt("en"), old, "campus", {"period": "all", "where": "corrector"}))[-1]
    assert plain["switch"] == "" and "c1r1s1" not in str(plain["plan"])  # an older report: only your own seat


def test_a_hidden_student_loses_their_seat_too(report):
    from app.dash.views import hide
    data = _with_seats(report)
    login = data["periods"]["all"]["received"][0]["corrector"]["login"]
    out = hide(data, frozenset({login.lower()}), "Hidden", "someone-else")
    assert out["periods"]["all"]["received"][0]["corrector"] == {**out["periods"]["all"]["received"][0]["corrector"], "login": "Hidden", "host": None}


def test_where_offers_the_other_side_only_when_it_was_looked_up(report):
    from app.dash.views import Page, campus
    data = {**report, "seat_days": 60}
    for D in data["periods"].values():
        for e in D["received"] + D["given"]:
            e["other_host_checked"] = False  # nothing in the last 60 days
    where = campus(Page(Fmt("en"), data, "campus", {"period": "all"}))[-1]
    assert where["switch"] == "" and "c1r1s1" not in str(where["plan"])  # straight to your own seat, no empty views


def test_the_projects_you_corrected_say_whom_and_with_which_marks(report):
    from app.dash.views import Page, corrected_table
    pg = Page(Fmt("en"), report, "evaluations", {"period": "all"})
    html = str(corrected_table(pg))
    e = pg.D["given"][0]
    assert f">{e['project']}<" in html and 'class="evals"' in html
    assert all(f">{c['login']}</a>" in html for c in e["correcteds"] if c.get("login"))


def test_people_carry_their_group_and_the_first_and_last_time_you_crossed(report):
    from app.dash.views import Page, people
    who = people(Page(Fmt("en"), report, "people", {"period": "all"}))[0]
    text = str(who["table"])
    p = report["periods"]["all"]["people"][0]
    assert ">Group<" in text and ">First<" in text and ">Last<" in text and p["first"][:10] in text
    conn = next(s for s in people(Page(Fmt("en"), report, "people", {"period": "all"})) if s["id"] == "connections")
    assert "table" not in conn


def test_an_open_project_shows_a_dash_for_its_final_mark(report):
    from app.dash.views import Page, projects
    D = report["periods"]["all"]
    open_ = {**D["projects"][0], "name": "still-open", "mark": None, "validated": None, "status": "in_progress"}
    data = {**report, "periods": {**report["periods"], "all": {**D, "projects": D["projects"] + [open_]}}}
    table = str(projects(Page(Fmt("en"), data, "projects", {"period": "all", "track": "all"}))[0]["table"])
    row = table[table.index(">still-open<"):]
    assert re.search(r'<td class="num"[^>]*>–</td>', row[:row.index("</tr>")])


def test_titles_and_expertises_come_before_quests(report):
    from app.dash.views import Page, home
    D = report["periods"]["all"]
    X = {**D["extras"], "titles": [{"name": "T", "at": "2025-01-01"}], "expertises": [{"name": "E", "value": 3}],
         "quests": [{"name": "Q", "validated": "2025-01-01"}]}
    data = {**report, "periods": {**report["periods"], "all": {**D, "extras": X}}}
    misc = str(next(s for s in home(Page(Fmt("en"), data, "home", {"period": "all"})) if s["id"] == "activity")["misc"])
    assert misc.index("</b> T") < misc.index("</b> E") < misc.index("</b> Q")


def test_the_projects_you_corrected_can_be_searched(report):
    from app.dash.views import Page, corrected_table
    name = report["periods"]["all"]["given"][0]["project"]
    html = str(corrected_table(Page(Fmt("en"), report, "evaluations", {"period": "all", "dq": name[:4].upper()})))
    assert f">{name}<" in html
    assert "No project matches" in str(corrected_table(Page(Fmt("en"), report, "evaluations", {"period": "all", "dq": "zzzz-none"})))


def test_a_long_or_several_line_comment_says_there_is_more_in_the_log(report):
    import copy
    from app.dash.views import Page, log_section
    data = copy.deepcopy(report)
    e = data["periods"]["all"]["received"][0]
    e["comment"] = "short first line\nand a second one"
    table = str(log_section(Page(Fmt("en"), data, "evaluations", {"period": "all"}))["table"])
    assert 'class="preview">short first line…<' in table


def test_feedback_comments_are_quoted_and_the_circle_tips_open_towards_the_middle(report):
    net = {"nodes": [{"login": "me", "group": "me"}, {"login": "a", "group": "rank-01"}, {"login": "b", "group": "rank-01"}],
           "links": [{"source": "a", "target": "me", "count": 1}, {"source": "b", "target": "me", "count": 1}]}
    svg = graphs.ring(Fmt("en"), net, width=400, height=400, compact=False, uid="t")
    assert 'class="net-node me-hit"' in svg.split('<g class="net-nodes">')[1]  # above the chords
    assert set(re.findall(r'data-side="(\w+)"', svg)) <= {"left", "right"} and 'data-side="' in svg
    from app.dash.views import Page, evaluations
    fb = next(s for s in evaluations(Page(Fmt("en"), report, "evaluations", {"period": "all"})) if s["id"] == "feedback")
    if 'class="note fb-quote"' in str(fb["low"]):
        assert re.search(r'class="note fb-quote">“[^<]+”<', str(fb["low"]))


async def test_the_landing_says_why_sign_in_waits(client):
    assert 'data-accept-first="Accept the privacy policy first"' in (await client.get("/")).text


def test_teammates_say_how_many_different_people(report):
    from app.dash.views import Page, people
    tm = next(s for s in people(Page(Fmt("en"), report, "people", {"period": "all"})) if s["id"] == "teammates")
    n = len((report["periods"]["all"].get("insights") or {}).get("teammates") or [])
    assert tm["count"] == (f"{n} person" if n == 1 else f"{n} people")
