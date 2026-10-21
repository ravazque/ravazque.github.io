import re

import pytest

from app.dash import charts, graphs
from app.dash.fmt import Fmt
from app.extract import extract
from app.store import Store
from test_extract import UID, FakeApi

PAGES = {"/app": "home", "/app/projects": "projects", "/app/evaluations": "evaluations", "/app/people": "people", "/app/campus": "campus"}
SECTIONS = {"/app": ["home-kpis", "pace", "skills", "activity"], "/app/projects": ["projects-table", "timeline", "exams"],
            "/app/evaluations": ["over-time", "when", "correction-stats", "feedback", "points", "log"],
            "/app/people": ["who", "connections", "teammates"], "/app/campus": ["seats", "days", "sessions", "where"]}
INLINE_SCRIPT = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>")


async def _noop(_):
    pass


@pytest.fixture
async def report(redis, settings):
    data = await extract(FakeApi(), UID, _noop)
    store = Store(redis, settings)
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
    r = await signed_in.get("/app/people?view=ring")
    assert 'hx-target="#connections"' in r.text and 'aria-pressed="true">' in r.text
    assert (await signed_in.get("/app/people?view=nonsense")).status_code == 200


async def test_with_nothing_stored_the_boot_screen_starts_the_extraction(signed_in, arq_pool):
    r = await signed_in.get("/app")
    assert r.status_code == 200 and 'id="boot"' in r.text and 'hx-get="/app/boot"' in r.text
    assert arq_pool.enqueued == ["extract_job"]


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


async def test_delete_asks_first_and_then_removes_everything(signed_in, report, redis, settings):
    page = await signed_in.get("/app/delete")
    assert 'action="/app/delete"' in page.text
    assert (await signed_in.post("/app/delete")).status_code == 403
    r = await signed_in.post("/app/delete", data={"csrf": signed_in.csrf["X-CSRF-Token"]})
    assert r.status_code == 303 and r.headers["location"] == "/"
    assert await Store(redis, settings).load_report(7) is None


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
    circles = [(float(x), float(y), float(r)) for x, y, r in re.findall(r'translate\(([\d.]+),([\d.]+)\)"><circle r="([\d.]+)"', svg)]
    assert len(circles) == sum(1 for p in people for d in ("received", "given") if p[d])
    for i, (x, y, r) in enumerate(circles):
        for x2, y2, r2 in circles[i + 1:]:
            assert (x - x2) ** 2 + (y - y2) ** 2 >= (r + r2) ** 2 - 1


@pytest.mark.parametrize("path", PAGES)
async def test_no_markup_is_shown_as_text(signed_in, report, path):
    text = (await signed_in.get(path)).text
    for leaked in ("&lt;span", "&lt;i ", "&lt;b&gt;", "&lt;a ", "&lt;svg", "&lt;br"):
        assert leaked not in text
