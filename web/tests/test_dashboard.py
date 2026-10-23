import re

import pytest

from app.dash import charts, graphs
from app.dash.fmt import Fmt
from app.extract import extract
from app.store import Store
from test_extract import UID, FakeApi

PAGES = {"/app": "home", "/app/projects": "projects", "/app/evaluations": "evaluations", "/app/people": "people", "/app/campus": "campus",
         "/app/astra": "astra"}
SECTIONS = {"/app": ["home-kpis", "rhythm", "pace", "skills", "activity"], "/app/projects": ["projects-table", "domains", "timeline", "exams"],
            "/app/evaluations": ["community", "over-time", "when", "correction-stats", "feedback", "points", "log"],
            "/app/people": ["who", "connections", "circle", "teammates"], "/app/campus": ["seats", "days", "sessions", "where"],
            "/app/astra": ["astra"]}
INLINE_SCRIPT = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>")


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
    circles = [(float(x), float(y), float(r)) for x, y, r in re.findall(r'translate\(([\d.]+),([\d.]+)\)"[^>]*>(?:<title>[^<]*</title>)?<circle class="halo" r="[\d.]+"/><circle class="core" r="([\d.]+)"', svg)]
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
