"""The five dashboard pages, built on the server from a stored report. Each builder returns the page's sections as
dicts of ready markup; the templates only lay them out. Query parameters carry every choice (period, filters, views)."""
import csv
import io
import json
import math
import re
from urllib.parse import urlencode

from markupsafe import Markup, escape

from . import astra as av
from . import extra as ex
from . import charts as ch
from . import graphs as gr

PAGES = {"home": "/app", "projects": "/app/projects", "evaluations": "/app/evaluations", "people": "/app/people", "campus": "/app/campus",
         "astra": "/app/astra"}
PROJECT_GROUPS = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06", "outer-core", "piscine"]
KINDS = ["nice", "rigorous", "interested", "punctuality"]
SAFE_COLOR = re.compile(r"^#[0-9a-fA-F]{3,8}$")


def safe_color(c) -> str:
    return c if SAFE_COLOR.match(c or "") else "var(--neutral)"


def initials(s) -> str:
    return "".join(w[0] for w in re.split(r"[\s._-]+", str(s or "?")) if w)[:2].upper()


def avatar(p) -> str:
    p = p or {}
    img = f'<img loading="lazy" src="{escape(p["image"])}" alt="">' if p.get("image") else ""
    return f'<span class="avatar" data-i="{escape(initials(p.get("name") or p.get("login")))}" aria-hidden="true">{img}</span>'


def my_rank(extras) -> str | None:
    main = next((c for c in (extras or {}).get("cursus", []) if c["name"] == "42cursus"), None)
    if not main:
        return None
    if main.get("grade") == "Alumni":
        return "alumni"
    done = [q["name"] for q in extras.get("quests", []) if q.get("validated")]
    if main.get("grade") == "Transcender" or "Common Core" in done:
        return "outer-core"
    ranks = [int(m.group(1)) for m in (re.fullmatch(r"Common Core Rank (\d\d)", n) for n in done) if m]
    return f"rank-{(max(ranks) + 1 if ranks else 0):02d}"


# ---------- tables ----------

def table(f, cols, rows, *, label, sort=None, empty=None, sticky=False, detail=None, group=None, tid=None) -> Markup:
    """cols: [{k, t, num, hide, nw, cls, f: row -> markup, sv: row -> sort value}]. The server sorts by sort=(k, dir);
    every cell carries its sort value so dash.js can re-sort without a request."""
    def sv(c, r):
        return c["sv"](r) if "sv" in c else r.get(c["k"])
    rows = list(rows)
    if sort:
        col = next(c for c in cols if c["k"] == sort[0])
        filled = [r for r in rows if sv(col, r) is not None]
        rows = sorted(filled, key=lambda r: sv(col, r), reverse=sort[1] < 0) + [r for r in rows if sv(col, r) is None]
    if group:
        rows = sorted(rows, key=lambda r: group["order"].index(group["key"](r)) if group["key"](r) in group["order"] else 99)

    def cls(c, *extra):
        return " ".join(x for x in ("num" if c.get("num") else "", "nowrap" if c.get("nw") else "", "narrow-hide" if c.get("hide") else "",
                                    c.get("cls", ""), *extra) if x)

    def cell(c, r):
        v = c["f"](r) if "f" in c else escape(r.get(c["k"]) if r.get(c["k"]) is not None else "")
        s = sv(c, r)
        return f'<td class="{cls(c)}" data-v="{escape("" if s is None else s)}">{v}</td>'

    def th(c):
        aria = f' aria-sort="{"ascending" if sort[1] > 0 else "descending"}"' if sort and c["k"] == sort[0] else ""
        return f'<th scope="col" class="{cls(c)}"{aria}><button type="button" data-num="{1 if c.get("num") else 0}">{escape(c["t"])}</button></th>'
    head = "".join(th(c) for c in cols)
    line = lambda r: "<tr>" + "".join(cell(c, r) for c in cols) + "</tr>"  # noqa: E731
    if not rows:
        body = f'<tbody><tr><td class="empty" colspan="{len(cols)}">{escape(empty or f("empty.period"))}</td></tr></tbody>'
    elif detail or group:
        parts, prev = [], object()
        for r in rows:
            g = group["key"](r) if group else None
            if group and g != prev:
                n = sum(1 for x in rows if group["key"](x) == g)
                parts.append(f'<tbody class="group"><tr><th scope="rowgroup" colspan="{len(cols)}">{escape(group["label"](g))} <span class="note">{n}</span></th></tr></tbody>')
                prev = g
            d = detail(r) if detail else ""
            parts.append(f'<tbody class="pair">{line(r)}<tr class="detail"><td colspan="{len(cols)}">{d}</td></tr></tbody>' if d else f"<tbody>{line(r)}</tbody>")
        body = "".join(parts)
    else:
        body = "<tbody>" + "".join(line(r) for r in rows) + "</tbody>"
    attrs = f' id="{tid}"' if tid else ""
    return Markup(f'<table{attrs} class="{"sticky-first" if sticky else ""}"{" data-nosort" if group else ""} aria-label="{escape(label)}">'
                  f"<thead><tr>{head}</tr></thead>{body}</table>")


def badge(text, kind="") -> str:
    return f'<span class="badge{" " + kind if kind else ""}">{escape(text)}</span>'


def flag_badge(f, e) -> str:
    if e.get("outstanding"):
        return badge(f("flag.outstanding"), "out")
    if e.get("negative_flag"):
        return badge(e.get("flag") or "", "bad")
    return badge(e["flag"]) if e.get("flag") else ""


def facts(rows) -> Markup:
    return Markup("".join(f"<div><dt>{escape(k)}</dt><dd>{v}</dd></div>" for k, v in rows))


# ---------- context shared by every page ----------

def hide(value, logins: frozenset, label: str, own: str):
    """A copy of the report where every opted-out student is a nameless, photoless label (the viewer is never hidden)."""
    if isinstance(value, dict):
        out = {k: hide(v, logins, label, own) for k, v in value.items()}
        if str(value.get("login", "")).lower() in logins and value.get("login") != own:
            out.update(login=label, **{k: None for k in ("name", "image", "displayname") if k in value})
        return out
    if isinstance(value, list):
        return [hide(v, logins, label, own) for v in value]
    if isinstance(value, str) and value.lower() in logins and value != own:
        return label
    return value


class Page:
    """One request's view of the report: the period, the formatter and the query parameters."""

    def __init__(self, f, data, key, params, optout=frozenset()):
        own = next(iter(data["periods"].values()))["profile"]["login"]
        if optout - {own.lower()}:
            data = hide(data, optout, f("common.hidden"), own)
        self.f, self.data, self.key, self.params = f, data, key, params
        periods = list(data["periods"])
        p = params.get("period")
        self.period = p if p in periods else data["default_period"]
        self.D = data["periods"][self.period]
        self.light = data.get("light") is True
        self.periods = periods

    def q(self, name, default="", allowed=None):
        v = self.params.get(name, default)
        return v if allowed is None or v in allowed else default

    def url(self, page=None, **change) -> str:
        """This page (or another) with the period kept and some parameters changed; None removes one."""
        keep = dict(self.params) if page in (None, self.key) else {}
        keep["period"] = self.period
        keep.update(change)
        qs = urlencode({k: v for k, v in keep.items() if v not in (None, "")})
        return f"{PAGES[page or self.key]}?{qs}" if qs else PAGES[page or self.key]

    def seg(self, name, options, current, *, label, target) -> Markup:
        """A segmented switch made of links; htmx swaps only the target section."""
        links = "".join(f'<a href="{escape(self.url(**{name: v}))}#{target}" role="button" aria-pressed="{str(v == current).lower()}">{escape(t)}</a>'
                        for v, t in options)
        return Markup(f'<div class="seg" role="group" aria-label="{escape(label)}" hx-boost="true" hx-target="#{target}"'
                      f' hx-select="#{target}" hx-swap="outerHTML show:none">{links}</div>')

    # rail
    def rail(self):
        f, D, P = self.f, self.D, self.D["profile"]
        L = D["logtime"]
        campus = P.get("campus_current") or (P["campus"][-1] if isinstance(P.get("campus"), list) and P["campus"] else P.get("campus") or "")
        stage = f(f"groups.{r}") if (r := my_rank(D["extras"])) else f("home.no_cursus")
        coal = P.get("coalition")
        coal_html = (Markup(f'<i style="background:{safe_color(coal.get("color"))}"></i>{escape(coal["name"])} · ') if coal else Markup()) + stage
        h, m = divmod(int(L["total_seconds"]) // 60, 60)
        rng = lambda p: (f"{f.day(self.data['periods'][p]['logtime']['first_day'])} → {f.day(self.data['periods'][p]['logtime']['last_day'])}"  # noqa: E731
                         if self.data["periods"][p]["logtime"].get("first_day") else f("rail.no_sessions"))
        return {
            "name": P.get("name") or P["login"], "login": P["login"], "campus": campus, "coalition": Markup(coal_html),
            "initials": initials(P.get("name")), "image": P.get("image"),
            "periods": [{"key": p, "label": f(f"period.{p}"), "time": f.hm(self.data["periods"][p]["logtime"]["total_seconds"]),
                         "href": self.url(period=p), "on": p == self.period} for p in self.periods] if len(self.periods) > 1 else [],
            "range": f("rail.logged_in", range=rng(self.period)), "h": h, "m": f"{m:02d}",
            "aria": f("rail.figure_aria", h=h, m=f"{m:02d}"),
            "stats": [(f.num(L["days_present"]), f("rail.days", count=L["days_present"])), (f.num(L["sessions"]), f("rail.sessions", count=L["sessions"])),
                      (f.num(len(L["seats"])), f("rail.computers", count=len(L["seats"])))],
            "now": f.html("rail.now_at", seat=Markup(f"<b>{escape(P['location'])}</b>")) if P.get("location") else f("rail.not_logged"),
            "official": f("rail.official", hm=f.hm(L["official_hours"] * 3600)) if L.get("official_hours") is not None else "",
            "groups": P.get("groups") or [],
        }

    def footer(self):
        f = self.f
        campuses = []
        for c in self.D.get("campuses") or []:
            when = f("foot.time", hours=f.num(c.get("hours"), 1), sessions=f.num(c.get("sessions"))) if c.get("sessions") else f("foot.no_sessions")
            campuses.append({"name": c.get("name") or "?", "primary": c.get("primary"), "city": c.get("city"),
                             "line": f"{f('foot.joined', when=f.day(c.get('joined')))} · {when}",
                             "span": f("foot.span", first=f.day(c["first"]), last=f.day(c["last"])) if c.get("first") else ""})
        return {"campuses": campuses, "note": f("footer.light" if self.light else "footer.full", when=self.D.get("generated", ""))}


# ---------- Home ----------

def home(pg: Page) -> list[dict]:
    f, D = pg.f, pg.D
    S, L, X = D["summary"], D["logtime"], D["extras"]
    top = L["seats"][0] if L["seats"] else None
    level = next((c for c in X["cursus"] if c["name"] == "42cursus"), X["cursus"][0] if X["cursus"] else None)
    rank = my_rank(X)
    xp = sum(p.get("xp_earned") or 0 for p in D["projects"])
    finished = [p for p in D["projects"] if p.get("mark") is not None]
    failed = (D.get("stats") or {}).get("failed_given")
    clusters = " · ".join(f"{c} {f.nb(h, 'h', 0)}" for c, h in L["clusters"].items())
    kpis = [
        (f("home.k_projects"), Markup(f"{S['validated']}<small> / {S['projects']}</small>"),
         [f("home.attempts", attempts=S["attempts"], retries=S["retries"]),
          f("home.avg_mark", mark=f.num(sum(p["mark"] for p in finished) / len(finished), 1)) if finished else ""]),
        (f("home.k_level"), Markup(f"{f.num(level['level'], 2)}<small> {escape(f('home.level'))}</small>") if level else "–",
         [f("home.rank", rank=f(f"groups.{rank}")) if rank else f("home.no_cursus"), f("home.xp", xp=f.num(xp))]),
        (f("home.k_evals"), f.num(S["received"]),
         [f("home.given", n=S["given"]), f("home.out", received=S["received_outstanding"], given=S["given_outstanding"]),
          f("home.failed", pct=f"{f.num(failed['pct'], 1)}%") if failed and failed.get("pct") is not None else ""]),
        (f("home.k_seat"), top["host"] if top else "–",
         [f("home.seat_hours", hours=f.nb(top["hours"], "h")) if top else "", f("home.days", days=f.plural(L["days_present"], "count.days")),
          f("home.clusters", list=clusters) if clusters else ""]),
    ]
    sections = [{"id": "home-kpis", "title": f("home.title"), "nav": f("nav.home_kpis"),
                 "kpis": [(k, v, [s for s in subs if s]) for k, v, subs in kpis]}]

    weeks, span = ex.active_weeks(L["days"], L["hours"])
    split = ex.day_split(L["heat"])
    to_validate = [p["days_to_validate"] for p in D["projects"] if p.get("validated") and p.get("days_to_validate") is not None]
    median = sorted(to_validate)[len(to_validate) // 2] if to_validate else None
    sections.append({"id": "rhythm", "title": f("rhythm.title"), "nav": f("rhythm.title"), "lede": f("rhythm.lede"), "kpis": [
        (f("rhythm.k_streak"), f.num(ex.streak(L["days"], L["hours"])), [f("rhythm.s_streak")]),
        (f("rhythm.k_weeks"), f.num(weeks), [f("rhythm.s_weeks", total=f.num(span))]),
        (f("rhythm.k_time"), f"{max(split.values())}%",
         [f("rhythm.s_mostly", part=f("rhythm." + max(split, key=split.get))), f("rhythm.s_time", m=split["morning"], a=split["afternoon"], n=split["night"])]),
        (f("rhythm.k_validate"), f.num(median, 1) if median is not None else "–",
         [f("rhythm.s_validate", n=len(to_validate)), f("rhythm.s_resilience", n=ex.resilience(D["projects"]))]),
    ]})

    pc = (D.get("insights") or {}).get("pace")
    if pc:
        months = pc["months"]
        sections.append({"id": "pace", "title": f("pace.title"), "nav": f("nav.pace"), "facts": facts([
            (f("pace.since"), escape(f.plural(pc["months_since_kickoff"], "pace.months")) if pc.get("months_since_kickoff") is not None else "–"),
            (f("pace.xp_month"), f.num(pc.get("xp_per_month"))),
            (f("pace.validated"), f.num(sum(m["validated"] for m in months))),
            (f("pace.blackhole"), escape(f("pace.no_blackhole") if pc.get("blackhole_days") is None else f.plural(pc["blackhole_days"], "pace.days_left")))]),
            "chart": ch.vbars(f, [f.month_label(m["month"]) for m in months], [(f("pace.xp"), [m["xp"] for m in months], ch.S1)],
                              label=f("pace.xp_title"), line=(f("pace.cumulative"), [m["cumulative"] for m in months], ch.S2),
                              fmt=lambda v: f.num(v), empty_text=f("empty.period")),
            "legend": ch.legend([(f("pace.xp"), ch.S1), (f("pace.cumulative"), ch.S2)])})

    cursus = pg.q("cursus", "42cursus", ("42cursus", "C Piscine"))
    view = pg.q("skills", "radar", ("radar", "bars"))
    items = (X.get("skills_by_cursus") or {}).get(cursus) or (X.get("skills", []) if cursus == "42cursus" else [])
    if view == "radar":
        skills = gr.radar(f, items, f("extras.skills_title")) if items else ch.empty(f("empty.period"))
    else:
        bars = sorted((s for s in items if s["level"] > 0), key=lambda s: -s["level"])
        skills = ch.hbars(f, [s["name"] for s in bars], [(f("extras.level"), [s["level"] for s in bars], ch.S1)],
                          label=f("extras.skills_title"), end=lambda i, v: f.num(v, 2), empty_text=f("empty.period"))
    sections.append({"id": "skills", "title": f("extras.skills_title"), "nav": f("extras.skills_title"), "chart": skills,
                     "switches": [pg.seg("cursus", [("42cursus", f("track.student")), ("C Piscine", f("track.piscine"))], cursus, label=f("skills.cursus"), target="skills"),
                                  pg.seg("skills", [("radar", f("skills.radar")), ("bars", f("skills.bars"))], view, label=f("skills.view"), target="skills")]})

    C, promo = pg.data.get("coalitions") or [], pg.data.get("promo")
    if C or promo:
        best = max([1] + [c["score"] for c in C])
        coal = Markup("".join(
            f'<li class="{"mine" if c.get("mine") else ""}"><span class="rank">{c["rank"]}</span><span class="name"><i style="background:{safe_color(c.get("color"))}"></i>'
            f'{escape(c["name"])}{" " + badge(f("standing.yours")) if c.get("mine") else ""}</span><span class="track"><b style="width:{100 * c["score"] / best:.1f}%;'
            f'background:{safe_color(c.get("color"))}"></b></span><span class="num">{f.num(c["score"])}</span></li>' for c in C))
        hist = promo["histogram"] if promo else []
        mine = math.floor(promo["mine"]) if promo else None
        mine_c = av.coalition(pg.data)
        coal_line = " · ".join(x for x in [mine_c["name"], f("astra.coal.rank", n=mine_c["rank"]) if mine_c["rank"] else "",
                                         f("astra.coal.score", n=f.num(mine_c["score"])) if mine_c["score"] is not None else "",
                                         f("astra.coal.master") if mine_c["master"] else ""] if x) if mine_c else ""
        sections.append({"id": "standing", "title": f("standing.title"), "nav": f("nav.standing"), "coalitions": coal, "mine": coal_line,
                         "promo_lede": f("standing.promo_lede", rank=f.num(promo["rank"]), size=f.num(promo["size"]), pct=f.num(promo["percentile"], 1),
                                         median=f.num(promo["median"], 2)) if promo else f("standing.no_promo"),
                         "promo": ch.vbars(f, [str(h["level"]) for h in hist],
                                           [(f("standing.students"), [h["count"] if h["level"] != mine else 0 for h in hist], ch.S2),
                                            (f("standing.yours"), [h["count"] if h["level"] == mine else 0 for h in hist], ch.S1)],
                                           label=f("standing.promo"), stacked=True, xtitle=f("standing.level_axis"), fmt=f.num) if promo else ""})

    none = Markup(f'<li class="note">{escape(f("empty.period"))}</li>')
    ev_kind = lambda k: f(f"event.{k}") if f(f"event.{k}") != f"event.{k}" else str(k).replace("_", " ")  # noqa: E731
    ach = "".join(f'<li><span><b>{escape(a["name"])}</b>{" " + badge(a["tier"]) if a.get("tier") and a["tier"] != "none" else ""}<br>'
                  f'<span class="note">{escape(a.get("description") or "")}</span></span><span class="when">{escape(a["at"][:10])}</span></li>' for a in reversed(X["achievements"]))
    evs = "".join(f'<li><span>{escape(e["name"])}<br><span class="note">{escape(ev_kind(e["kind"]))}{" · " + escape(e["location"]) if e.get("location") else ""}'
                  f'{f" · {e["hours"]} h" if e.get("hours") else ""}</span></span><span class="when">{escape(e["begin"])}</span></li>' for e in reversed(X["events"]))
    misc = ([f'<li><span><b>{escape(f("extras.quest"))}</b> {escape(q["name"])}<br><span class="note">{escape(q.get("description") or "")}</span></span>'
             f'<span class="when">{escape((q.get("validated") or f("extras.in_progress"))[:10])}</span></li>' for q in X["quests"]]
            + [f'<li><span><b>{escape(f("extras.title_item"))}</b> {escape(x["name"])}{" " + badge(f("extras.selected")) if x.get("selected") else ""}</span>'
               f'<span class="when">{escape(x["at"][:10])}</span></li>' for x in X["titles"]]
            + [f'<li><span><b>{escape(f("extras.expertise"))}</b> {escape(x["name"])}</span><span class="when">{x["value"]} / 5</span></li>' for x in X["expertises"]])
    sections.append({"id": "activity", "title": f("activity.title"), "nav": f("activity.title"),
                     "achievements": Markup(ach) or none, "events": Markup(evs) or none, "misc": Markup("".join(misc)) or none,
                     "event_kinds": " · ".join(f"{ev_kind(k)}: {v}" for k, v in X["event_kinds"].items())})
    return sections


# ---------- Projects ----------

def project_view(projects, track, search, marks, year):
    q = search.strip().lower()
    mark_ok = {"bonus": lambda p: (p.get("mark") or 0) > 100, "max": lambda p: p.get("mark") == 125,
               "failed": lambda p: not p.get("validated") and p.get("mark") is not None and p.get("status") == "finished"}.get(marks, lambda p: True)
    return [p for p in projects
            if (track == "all" or (p["track"] == "piscine") == (track == "piscine"))
            and (not q or q in p["name"].lower()) and mark_ok(p)
            and (year == "all" or (p.get("marked") or p.get("registered") or "").startswith(year))]


def project_filters(pg: Page):
    years = sorted({(p.get("marked") or p.get("registered") or "")[:4] for p in pg.data["periods"].get("all", pg.D)["projects"]} - {""}, reverse=True)
    return {"track": pg.q("track", "student", ("student", "piscine", "all")), "search": pg.q("q", "")[:80],
            "marks": pg.q("marks", "all", ("all", "bonus", "max", "failed")), "year": pg.q("year", "all", ["all", *years]),
            "grouped": pg.q("group") == "1", "years": years}


def mark_chip(f, a) -> str:
    state = "pass" if a.get("validated") is True else "fail" if a.get("validated") is False else "open" if a.get("mark") is None else ""
    outcome = f", {f('outcome.validated').lower()}" if a.get("validated") is True else f", {f('outcome.failed').lower()}" if a.get("validated") is False else ""
    title = " · ".join(x for x in [f("projects.attempt_title", n=a["n"]) + outcome, a.get("start"),
                                   f("projects.with", list=", ".join(a["members"])) if a.get("members") else "",
                                   f("projects.moulinette", marks=", ".join(str(m["mark"]) for m in a["moulinette"])) if a.get("moulinette") else ""] if x)
    return f'<span class="mark {state}" title="{escape(title)}">{escape(a["mark"] if a.get("mark") is not None else f("projects.pending"))}</span>'


def group_label(f, g):
    return f("track.piscine") if g == "piscine" else f(f"groups.{g}")


def portfolio_csv(pg: Page) -> str:
    f = pg.f
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow([f("col.project"), f("col.track"), f("col.areas"), f("col.started"), f("col.marked"), f("col.final"), f("col.attempts"),
                f("col.xp"), f("col.team"), f("col.days_to_validate")])
    w.writerows(ex.portfolio_rows(pg.data["periods"].get("all", pg.D)["projects"]))
    return out.getvalue()


def projects_csv(pg: Page) -> str:
    f, fl = pg.f, project_filters(pg)
    rows = project_view(pg.data["periods"].get("all", pg.D)["projects"], fl["track"], fl["search"], fl["marks"], fl["year"])
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    w.writerow([f("col.project"), f("col.track"), f("col.group"), f("col.status"), f("col.final"), f("col.attempts"), f("col.outstanding"),
                f("col.xp"), f("col.started"), f("col.marked")])
    for p in rows:
        w.writerow([p["name"], f(f"track.{p['track']}"), group_label(f, p.get("group") or p["track"]), p.get("status"), p.get("mark"),
                    len(p["attempts"]), p.get("outstanding"), p.get("xp_earned"), (p.get("registered") or "")[:10], (p.get("marked") or "")[:10]])
    return out.getvalue()


def projects(pg: Page) -> list[dict]:
    f, D = pg.f, pg.D
    fl = project_filters(pg)
    rows = project_view(pg.data["periods"].get("all", D)["projects"], fl["track"], fl["search"], fl["marks"], fl["year"])

    def eval_line(e):
        state = "open" if e.get("mark") is None else "fail" if e.get("negative") or e["mark"] < 50 else "pass"
        flag = " " + badge(f("flag.outstanding"), "out") if e.get("outstanding") else " " + badge(e.get("flag") or "", "bad") if e.get("negative") else ""
        return (f'<li><span class="code">{escape(e.get("corrector"))}</span> <span class="mark {state}">{escape(e["mark"] if e.get("mark") is not None else "–")}</span>'
                f'{flag} <span class="note">{escape(e.get("begin") or "")}</span></li>')

    def detail(p):
        if not p["attempts"]:
            return ""
        items = "".join(
            f'<li><p><b>{escape(f("projects.attempt_title", n=a["n"]))}</b> {mark_chip(f, a)} <span class="note">{escape(a.get("start"))} → '
            f'{escape(a.get("closed") or a.get("locked") or f("projects.tip_open"))}</span></p>'
            f'<p class="note">{escape(f("projects_table.team", list=", ".join(a["members"])) if a.get("members") else f("projects_table.solo"))}</p>'
            + (f'<ul class="evals">{"".join(eval_line(e) for e in a["evaluations"])}</ul>' if a.get("evaluations") else f'<p class="note">{escape(f("projects_table.no_evals"))}</p>')
            + "</li>" for a in p["attempts"])
        n = len(p["attempts"])
        return f'<details><summary>{escape(f("projects_table.detail", count=n, n=n))}</summary><ol class="attempts">{items}</ol></details>'

    def status(p):
        s = p.get("status") or ""
        return escape(f(f"status.{s}") if f(f"status.{s}") != f"status.{s}" else s.replace("_", " "))

    tbl = table(f, [
        {"k": "name", "t": f("col.project"), "cls": "proj", "f": lambda p: f'{escape(p["name"])}{" " + badge(f("projects.exam")) if p.get("exam") else ""}'},
        {"k": "track", "t": f("col.track"), "nw": True, "hide": True, "f": lambda p: badge(f(f"track.{p['track']}"))},
        {"k": "status", "t": f("col.status"), "nw": True, "hide": True, "f": status},
        {"k": "mark", "t": f("col.final"), "num": True},
        {"k": "attempts", "t": f("col.attempts"), "cls": "marks-col", "sv": lambda p: len(p["attempts"]),
         "f": lambda p: '<span class="marks">' + "".join(mark_chip(f, a) if i == 0 else f'<span class="step">→{mark_chip(f, a)}</span>'
                                                          for i, a in enumerate(p["attempts"])) + "</span>"},
        {"k": "outstanding", "t": f("col.outstanding"), "num": True},
        {"k": "xp_earned", "t": f("col.xp"), "num": True, "nw": True,
         "f": lambda p: f'{f.num(p.get("xp_earned"))}<span class="sub">{escape(f("projects_table.xp_base", xp=f.num(p.get("xp_base"))))}</span>'},
        {"k": "first_ms", "t": f("col.started"), "nw": True, "hide": True, "f": lambda p: escape((p.get("registered") or "")[:10])},
    ], rows, label=f("projects_table.title"), sort=("first_ms", -1), sticky=True, detail=detail, empty=f("projects_table.none"),
        group={"key": lambda p: p.get("group") or p["track"], "order": PROJECT_GROUPS, "label": lambda g: group_label(f, g)} if fl["grouped"] else None)
    sections = [{"id": "projects-table", "title": f("projects_table.title"), "nav": f("nav.projects_table"), "filters": fl,
                 "count": f.plural(len(rows), "projects_table.count"), "table": tbl,
                 "csv": pg.url(None).replace(PAGES["projects"], "/app/projects.csv", 1)}]

    areas = ex.domains(pg.data["periods"].get("all", D)["projects"])
    sections.append({"id": "domains", "title": f("domains.title"), "nav": f("domains.title"), "lede": f("domains.lede"),
                     "chart": ch.hbars(f, [(lambda t: t[:1].upper() + t[1:])(f(f"astra.tag.{a['key']}")) for a in areas], [(f("col.xp"), [a["xp"] for a in areas], ch.S1)],
                                       label=f("domains.title"), tips=[f"{f(f'astra.tag.{a['key']}')} · ≈ {f.num(a['xp'])} XP · {', '.join(a['projects'])}" for a in areas],
                                       end=lambda i, v: f"≈ {f.num(v)}", extra=lambda i: f.plural(len(areas[i]["projects"]), "domains.projects"),
                                       empty_text=f("domains.none")),
                     "portfolio": pg.url(None).replace(PAGES["projects"], "/app/portfolio.csv", 1)})

    tl_rows = []
    for p in D["projects"]:
        spans = []
        for a in p["attempts"]:
            c = ch.GOOD if a.get("validated") is True else ch.BAD if a.get("validated") is False else ch.NEUTRAL
            outcome = f("outcome.validated") if a.get("validated") else f("outcome.failed") if a.get("validated") is False else a.get("status") or ""
            tip = " · ".join(x for x in [
                f("projects.tip_title", name=p["name"], n=a["n"], of=len(p["attempts"])), f"{outcome} · {f('projects.tip_mark', mark=a.get('mark') if a.get('mark') is not None else '–')}",
                f"{a.get('start')} → {a.get('closed') or a.get('locked') or f('projects.tip_open')} ({f('projects.tip_days', n=f.num(a.get('days'), 1))})",
                f.plural(len(a.get("evals") or []), "count.evaluations") + (f" · {a['outstanding']} {f('flag.outstanding')}" if a.get("outstanding") else ""),
                f("projects.by", list=", ".join(a["correctors"])) if a.get("correctors") else "",
                f("projects.team", list=", ".join(a["members"])) if a.get("members") else ""] if x)
            spans.append((a["start_ms"], a.get("end_ms") or a["start_ms"], c, tip))
        tl_rows.append((p["name"], spans))
    retries = sorted(({"x": a["start_ms"], "y": 0} for p in D["projects"] for a in p["attempts"][1:]), key=lambda p: p["x"])
    for i, r in enumerate(retries):
        r["y"] = i + 1
    sections.append({"id": "timeline", "title": f("projects.title"), "nav": f("nav.projects"), "lede": f("projects.lede"),
                     "legend": ch.legend([(f("outcome.validated"), ch.GOOD), (f("outcome.failed"), ch.BAD), (f("outcome.in_progress"), ch.NEUTRAL)]),
                     "timeline": ch.timeline(f, tl_rows, label=f("projects.timeline_aria"), empty_text=f("empty.period")),
                     "retries": ch.lines(f, [(f("col.retries"), retries, ch.S1)], label=f("projects.cum_title"), empty_text=f("empty.period"))})

    exams_done = (D.get("insights") or {}).get("exams") or []
    sections.append({"id": "exams", "title": f("exams.title"), "nav": f("nav.exams"), "table": table(f, [
        {"k": "name", "t": f("col.exam"), "nw": True},
        {"k": "passed", "t": f("col.status"), "nw": True, "sv": lambda e: 1 if e.get("passed") else 0,
         "f": lambda e: badge(f("exams.passed" if e.get("passed") else "exams.pending"), "out" if e.get("passed") else "")},
        {"k": "attempts", "t": f("col.attempts"), "num": True}, {"k": "best", "t": f("col.best"), "num": True},
        {"k": "days_to_pass", "t": f("col.days_to_pass"), "num": True, "f": lambda e: escape(f.num(e.get("days_to_pass")))},
        {"k": "tries", "t": f("col.tries"), "sv": lambda e: len(e["tries"]), "f": lambda e: '<span class="marks">' + "".join(
            f'<span class="mark {"pass" if x.get("passed") else "fail"}" title="{escape(f.day(x.get("date")))}">{escape(x["mark"] if x.get("mark") is not None else "–")}</span>'
            for x in e["tries"]) + "</span>"},
    ], exams_done, label=f("exams.title"), sort=("name", 1), empty=f("exams.none"))})
    return sections


# ---------- Evaluations ----------

def evaluations(pg: Page) -> list[dict]:
    f, D = pg.f, pg.D
    S, W = D["summary"], D["when"]
    role = pg.q("role", "received", ("received", "given"))
    base = ch.S1 if role == "received" else ch.S2
    m = W[f"{role}_monthly"]
    lede = (f("received.lede", n=S["received"], mark=f.num(S["received_avg_mark"], 1), outstanding=S["received_outstanding"],
              pct=f.pct(S["received_outstanding"], S["received"]), negative=S["received_negative"]) if role == "received" else
            f("given.lede", n=S["given"], mark=f.num(S["given_avg_mark"], 1), outstanding=S["given_outstanding"], negative=S["given_negative"],
              rating=f.num(S["ratings_i_received"]["rating"], 2)))
    bins = [("0", lambda x: x == 0), ("1–49", lambda x: 0 < x < 50), ("50–79", lambda x: 50 <= x < 80), ("80–99", lambda x: 80 <= x < 100),
            ("100", lambda x: x == 100), ("101–124", lambda x: 100 < x < 125), ("125", lambda x: x >= 125)]
    count = lambda evs: [sum(1 for e in evs if e.get("mark") is not None and ok(e["mark"])) for _, ok in bins]  # noqa: E731
    roles = [(f("role.received"), ch.S1), (f("role.given"), ch.S2)]
    cm = ex.community(D["given"], D["received"])
    sections = [{"id": "community", "title": f("community.title"), "nav": f("community.title"), "lede": f("community.lede"), "kpis": [
        (f("community.k_hours"), f.nb(cm["hours"], "h"), [f("community.s_hours", n=f.num(len(D["given"])))]),
        (f("community.k_people"), f.num(cm["people"]), [f("community.s_people")]),
        (f("community.k_correctors"), f.num(cm["correctors"]), [f("community.s_correctors")]),
        (f("community.k_rating"), f.num(cm["rating"], 2) if cm["rating"] is not None else "–", [f("community.s_rating", n=f.num(cm["rated"]))]),
    ]}]
    sections += [{"id": "over-time", "title": f("over_time.title"), "nav": f("over_time.title"), "lede": lede,
                 "switch": pg.seg("role", [("received", f("role.received")), ("given", f("role.given"))], role, label=f("log.role_label"), target="over-time"),
                 "monthly_title": f("received.monthly_title" if role == "received" else "given.monthly_title"),
                 "flags": ch.legend([(f("flag.ok"), base), (f("flag.outstanding"), ch.GOOD), (f("flag.negative"), ch.BAD)]),
                 "monthly": ch.vbars(f, [f.month_label(x) for x in W["months"]],
                                     [(f("flag.ok"), m["ok"], base), (f("flag.outstanding"), m["outstanding"], ch.GOOD), (f("flag.negative"), m["negative"], ch.BAD)],
                                     label=f("received.monthly_title"), stacked=True, fmt=f.num, empty_text=f("empty.period")),
                 "roles": ch.legend(roles),
                 "marks": ch.vbars(f, [b for b, _ in bins], [(f("role.received"), count(D["received"]), ch.S1), (f("role.given"), count(D["given"]), ch.S2)],
                                   label=f("received.marks_title"), xtitle=f("received.final_mark"), fmt=f.num, empty_text=f("empty.period")),
                 "cum": ch.lines(f, [(f("role.received"), W["cum_received"], ch.S1), (f("role.given"), W["cum_given"], ch.S2)],
                                 label=f("received.cum_title"), empty_text=f("empty.period")),
                 "cum_out": ch.lines(f, [(f("received.out_received"), W["cum_out_received"], ch.S1), (f("received.out_given"), W["cum_out_given"], ch.S2)],
                                     label=f("received.cum_out_title"), empty_text=f("empty.period"))}]

    edges = lambda e: [f"{x}–{e[i + 1]}" if i < len(e) - 1 else f"{x}+" for i, x in enumerate(e)]  # noqa: E731
    dp = (D.get("insights") or {}).get("evaluations")
    dur = lambda d: "–" if d.get("avg") is None else f("depth.minutes", avg=f.num(d["avg"]), median=f.num(d["median"]))  # noqa: E731
    sections.append({
        "id": "when", "title": f("when.title"), "nav": f("nav.when"),
        "lede": f("when.lede", recv=f.num(W["median_duration_received"]), given=f.num(W["median_duration_given"]), lead=f.num(W["median_lead_received"], 1)),
        "heat_recv": gr.heat(f, W["heat_received"], gr.AMBER, f("unit.evaluations")), "heat_given": gr.heat(f, W["heat_given"], gr.SLATE, f("unit.evaluations")),
        "roles": ch.legend(roles),
        "duration": ch.vbars(f, edges(W["duration_edges"]), [(f("role.received"), W["duration_received"], ch.S1), (f("role.given"), W["duration_given"], ch.S2)],
                             label=f("when.duration_title"), xtitle=f("when.minutes"), fmt=f.num, empty_text=f("empty.period")),
        "lead": ch.vbars(f, edges(W["lead_edges"]), [(f("role.received"), W["lead_received"], ch.S1), (f("role.given"), W["lead_given"], ch.S2)],
                         label=f("when.lead_title"), xtitle=f("when.hours_before"), fmt=f.num, empty_text=f("empty.period")),
        "facts": facts([(f("depth.received_duration"), escape(dur(dp["received_duration"]))), (f("depth.given_duration"), escape(dur(dp["given_duration"]))),
                        (f("depth.lead"), escape("–" if dp.get("received_lead_h") is None else f("depth.hours", h=f.num(dp["received_lead_h"], 1)))),
                        (f("depth.streak"), f.num(dp.get("outstanding_streak")))]) if dp else "",
        "depth": table(f, [
            {"k": "project", "t": f("col.project"), "nw": True},
            {"k": "received", "t": f("col.received"), "num": True}, {"k": "received_avg", "t": f("col.avg_received"), "num": True, "f": lambda r: f.num(r.get("received_avg"), 1)},
            {"k": "received_outstanding", "t": f("col.outstanding"), "num": True},
            {"k": "given", "t": f("col.given"), "num": True}, {"k": "given_avg", "t": f("col.avg_given"), "num": True, "hide": True, "f": lambda r: f.num(r.get("given_avg"), 1)},
        ], dp["projects"], label=f("depth.title"), sort=("received", -1)) if dp else ""})

    st = D.get("stats")
    if st:
        rate = lambda r, key: (f'<div><p class="v">{"–" if r.get("pct") is None else f"{f.num(r["pct"], 1)}<small>%</small>"}</p><p class="k">{escape(f(key))}</p>'  # noqa: E731
                               f'<p class="s">{escape(f("stats.of", n=r["n"], total=r["total"]))}</p></div>')
        R = st["outstanding_reciprocity"]
        order = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06", "outer-core", "alumni", "no-cursus"]
        groups = [{"g": g, **v, "i": order.index(g) if g in order else 99, "in_pct": 100 * v["received_out"] / v["received"] if v.get("received") else None,
                   "out_pct": 100 * v["given_out"] / v["given"] if v.get("given") else None} for g, v in (st.get("by_group") or {}).items()]
        h = st.get("by_hour") or []
        sections.append({"id": "correction-stats", "title": f("stats.title"), "nav": f("nav.correction_stats"), "lede": f("stats.lede"),
                         "rates": Markup(rate(st["failed_given"], "stats.failed_given") + rate(st["failed_received"], "stats.failed_received")
                                         + f'<div><h3>{escape(f("stats.reciprocity_title"))}</h3><p class="s">{escape(f("stats.recip_in", back=R["i_gave_back"], gave_me=R["gave_me"]))}</p>'
                                         f'<p class="s">{escape(f("stats.recip_out", back=R["they_gave_back"], i_gave=R["i_gave"]))}</p></div>'),
                         "groups": table(f, [
                             {"k": "i", "t": f("col.group"), "f": lambda r: escape(f(f"groups.{r['g']}"))},
                             {"k": "received", "t": f("col.received"), "num": True},
                             {"k": "in_pct", "t": f("col.out_pct"), "num": True, "f": lambda r: "–" if r["in_pct"] is None else f"{f.num(r['in_pct'])}%"},
                             {"k": "given", "t": f("col.given"), "num": True},
                             {"k": "out_pct", "t": f("col.out_pct"), "num": True, "f": lambda r: "–" if r["out_pct"] is None else f"{f.num(r['out_pct'])}%"},
                         ], groups, label=f("stats.group_title"), sort=("i", 1)) if groups else "",
                         "roles": ch.legend(roles),
                         "by_hour": ch.vbars(f, [f"{x['hour']:02d}" for x in h], [(f("role.received"), [x["received"] for x in h], ch.S1),
                                                                                 (f("role.given"), [x["given"] for x in h], ch.S2)],
                                             label=f("stats.hour_title"), fmt=f.num, every=3, empty_text=f("empty.period"))})

    P = D["profile"]
    mine = [fb for e in D["received"] for fb in e["feedbacks"] if fb.get("by") == P["login"]]
    theirs = [fb for e in D["given"] for fb in e["feedbacks"]]
    below = lambda fbs, k, top: sum(1 for x in fbs if x.get(k) is not None and x[k] < top)  # noqa: E731
    crit = ""
    if not pg.light:
        rows = [{"label": f"{f(f'criterion.{lab}')} (/{top})", "mineAvg": S["my_rating_of_correctors"].get(k), "mineLow": below(mine, k, top),
                 "theirAvg": S["ratings_i_received"].get(k), "theirLow": below(theirs, k, top)} for lab, k, top in [("overall", "rating", 5)] + [(k, k, 4) for k in KINDS]]
        crit = table(f, [{"k": "label", "t": f("col.criterion")},
                         {"k": "mineAvg", "t": f("col.you_to_correctors", n=len(mine)), "num": True,
                          "f": lambda r: f'{f.num(r["mineAvg"], 2)}<span class="sub">{escape(f("feedback.below_max", n=r["mineLow"]))}</span>'},
                         {"k": "theirAvg", "t": f("col.evaluated_to_you", n=len(theirs)), "num": True,
                          "f": lambda r: f'{f.num(r["theirAvg"], 2)}<span class="sub">{escape(f("feedback.below_max", n=r["theirLow"]))}</span>'}],
                     rows, label=f("feedback.criteria_title"))
    rated = [{**x, "project": e["project"], "begin": e["begin"]} for e in D["given"] for x in e["feedbacks"] if x.get("rating") is not None]
    low = sorted((x for x in rated if x["rating"] < 5 or any(x.get(k) is not None and x[k] < 4 for k in KINDS)),
                 key=lambda x: (x["rating"], sum(x.get(k) if x.get(k) is not None else 4 for k in KINDS)))
    def low_item(x):
        crit = " · ".join(f"{f('criterion.' + k)} {x[k]}/4" for k in KINDS if x.get(k) is not None and x[k] < 4)
        return (f'<li><span><b>{x["rating"]}/5</b>{" · " + escape(crit) if crit else ""} · {escape(f("feedback.by", login=x.get("by") or "?", project=x["project"]))}'
                f'<br><span class="note">{escape(x.get("comment") or "")}</span></span><span class="when">{escape(x["begin"][:10])}</span></li>')
    low_items = "".join(low_item(x) for x in low)
    sections.append({"id": "feedback", "title": f("feedback.title"), "nav": f("nav.feedback"), "lede": f("feedback.lede"), "criteria": crit,
                     "low_note": f("feedback.low_note", low=len(low), ratings=f.plural(len(rated), "count.ratings")) if rated else "",
                     "low": Markup(low_items or f'<li class="note">{escape(f("feedback.all_max" if rated else "empty.ratings"))}</li>')})

    CP = D["correction_points"]
    sections.append({"id": "points", "title": f("points.title"), "nav": f("nav.points"),
                     "lede": f("points.lede", earned=CP["earned"], spent=CP["spent"], max=CP["max"]) if CP["series"] else f("empty.points"),
                     "chart": ch.lines(f, [(f("points.balance"), CP["series"], ch.S1)], label=f("points.balance_title"), empty_text=f("empty.points")),
                     "table": table(f, [{"k": "reason", "t": f("col.reason")}, {"k": "count", "t": f("col.times"), "num": True}, {"k": "sum", "t": f("col.net"), "num": True}],
                                    [{"reason": k, **v} for k, v in CP["reasons"].items()], label=f("points.reasons_title"), sort=("count", -1))})
    sections.append(log_section(pg))
    return sections


def log_section(pg: Page) -> dict:
    f, D = pg.f, pg.D
    role = pg.q("log", "received", ("received", "given"))
    flag = pg.q("flag", "", ("", "out", "bad", "ok"))
    projects_all = sorted({e["project"] for e in D["received"] + D["given"]})
    proj = pg.q("project", "", ["", *projects_all])
    q = pg.q("q", "")[:80].lower()
    attempt_of = {a["team_id"]: a["n"] for p in D["projects"] for a in p["attempts"]}

    def match(e):
        if flag and not (e.get("outstanding") if flag == "out" else e.get("negative_flag") if flag == "bad" else not e.get("outstanding") and not e.get("negative_flag")):
            return False
        if proj and e["project"] != proj:
            return False
        hay = json.dumps([e["corrector"].get("login"), [c.get("login") for c in e.get("correcteds", [])], e.get("comment"), e.get("feedback"),
                          e.get("feedbacks"), e.get("my_host"), e.get("other_host"), e["project"], e.get("begin")], ensure_ascii=False).lower()
        return not q or q in hay

    rows = [e for e in D[role] if match(e)]

    def fb_text(e):
        if not e.get("comment") and not e.get("feedbacks"):
            return ""
        parts = [f'<div class="txt"><b>{escape(f("log.corrector_comment"))}</b>\n{escape(e["comment"])}</div>'] if e.get("comment") else []
        for x in e["feedbacks"]:
            kinds = " · ".join(f"{f(f'criterion.{k}')} {x[k]}/4" for k in KINDS if x.get(k) is not None)
            parts.append(f'<div class="txt"><b>{escape(f("log.feedback_by", login=x.get("by") or "?", rating=x["rating"] if x.get("rating") is not None else "–"))}</b>'
                         + (f' <span class="note">{escape(kinds)} · {escape(x.get("at") or "")}</span>' if kinds else "") + f'\n{escape(x.get("comment") or "")}</div>')
        n = len(e["feedbacks"])
        what = (f("log.comment_and_feedback", count=n, n=n) if e.get("comment") and n else f("log.comment_only") if e.get("comment")
                else f("log.feedback_only", count=n, n=n))
        preview = re.sub(r"\s+", " ", e.get("comment") or (e["feedbacks"][0].get("comment") if n else "") or "")[:140]
        return f'<details><summary>{escape(what)}<span class="preview">{escape(preview)}</span></summary>{"".join(parts)}</details>'

    flag_col = {"k": "flag", "t": f("col.flag"), "nw": True, "sv": lambda e: 2 if e.get("outstanding") else 0 if e.get("negative_flag") else 1, "f": lambda e: flag_badge(f, e)}
    min_col = {"k": "duration_min", "t": f("col.minutes"), "num": True, "nw": True, "hide": True,
               "f": lambda e: f'{f.num(e.get("duration_min"))} <span class="note">/ {e.get("planned_min")}</span>'
                              + (f'<span class="sub">{escape(f("log.booked_ahead", h=f.num(e["lead_h"], 1)))}</span>' if e.get("lead_h") is not None else "")}
    my_seat = lambda e: escape(e.get("my_host") or f("log.not_logged"))  # noqa: E731
    if role == "received":
        cols = [{"k": "begin_ms", "t": f("col.when"), "nw": True, "f": lambda e: escape(e["begin"])},
                {"k": "project", "t": f("col.project"), "nw": True, "f": lambda e: f'{escape(e["project"])}<span class="sub">{escape(f("projects.attempt", n=attempt_of.get(e.get("team_id"), "?")))}</span>'},
                {"k": "corrector", "t": f("col.corrector"), "nw": True, "sv": lambda e: e["corrector"].get("login"), "f": lambda e: f'{avatar(e["corrector"])}{escape(e["corrector"].get("login"))}'},
                {"k": "my_host", "t": f("col.your_seat"), "nw": True, "hide": True, "f": my_seat} if pg.light else
                {"k": "other_host", "t": f("col.seats"), "nw": True, "hide": True,
                 "f": lambda e: f'{escape(e.get("other_host") or (f("log.not_logged") if e.get("other_host_checked") else "–"))}'
                                f'<span class="sub">{escape(f("log.you_seat", seat=e.get("my_host") or f("log.not_logged")))}</span>'},
                min_col, {"k": "mark", "t": f("col.mark"), "num": True}, flag_col, {"k": "fb_rating", "t": f("col.your_rating"), "num": True, "hide": True}]
    else:
        cols = [{"k": "begin_ms", "t": f("col.when"), "nw": True, "f": lambda e: escape(e["begin"])},
                {"k": "project", "t": f("col.project"), "nw": True},
                {"k": "correcteds", "t": f("col.evaluated"), "nw": True, "sv": lambda e: ",".join(c.get("login", "") for c in e["correcteds"]),
                 "f": lambda e: "<br>".join(f'{avatar(c)}{escape(c.get("login"))}' for c in e["correcteds"])},
                {"k": "my_host", "t": f("col.your_seat"), "nw": True, "hide": True, "f": my_seat},
                min_col, {"k": "mark", "t": f("col.mark"), "num": True}, flag_col, {"k": "fb_rating", "t": f("col.their_rating"), "num": True, "hide": True}]
    return {"id": "log", "title": f("log.title"), "nav": f("nav.log"), "lede": f("log.lede"), "role": role, "flag": flag, "project": proj,
            "projects": projects_all, "q": pg.q("q", "")[:80], "count": f.plural(len(rows), "count.evaluations"),
            "table": table(f, cols, rows, label=f("log.title"), sort=("begin_ms", -1), empty=f("empty.search_log"), sticky=True, detail=fb_text)}


# ---------- People ----------

def circle_links(net, me, given, received) -> dict:
    """The circle's links with the student's own side rebuilt from their evaluations: the contacts' lists only see
    "contact → me", so both directions with the student come from given (me → them) and received (them → me)."""
    known = {n["login"] for n in net.get("nodes") or []} - {me}
    links = {(l["source"], l["target"]): l["count"] for l in net.get("links") or [] if me not in (l["source"], l["target"])}
    for e in given:
        for c in e.get("correcteds") or []:
            if c.get("login") in known:
                links[(me, c["login"])] = links.get((me, c["login"]), 0) + 1
    for e in received:
        login = (e.get("corrector") or {}).get("login")
        if login in known:
            links[(login, me)] = links.get((login, me), 0) + 1
    return {**net, "links": [{"source": s_, "target": t, "count": n} for (s_, t), n in links.items()]}


def people(pg: Page) -> list[dict]:
    f, D = pg.f, pg.D
    S = D["summary"]
    most = max((p for p in D["people"] if p.get("outstanding_to_me")), key=lambda p: p["outstanding_to_me"], default=None)
    top = [p for p in D["people"] if p.get("evaluated_me")][:25]
    q = pg.q("q", "")[:80].lower()
    rows = [p for p in D["people"] if not q or q in json.dumps([p["login"], p.get("name"), p.get("projects_on_me"), p.get("hosts")], ensure_ascii=False).lower()]
    first_of = lambda xs, n: f("common.first_of", list=", ".join(xs[:n]), more=len(xs) - n) if len(xs) > n else ", ".join(xs)  # noqa: E731

    def details(p):
        projs = [f"{k} ×{v}" if v > 1 else k for k, v in p["projects_on_me"].items()]
        seats = list(p.get("hosts") or {})
        line = " · ".join(x for x in [f("who.seats", list=first_of(seats, 2)) if seats else "", f"{p['first'][:10]} → {p['last'][:10]}" if p.get("first") else ""] if x)
        return (f'<span title="{escape(", ".join(projs))}">{escape(first_of(projs, 3) or "–")}</span>'
                + (f'<span class="sub" title="{escape(", ".join(seats))}">{escape(line)}</span>' if line else ""))

    def tip(p):
        return " · ".join([p["login"], f("who.tip_mark", mark=f.num(p.get("avg_mark_to_me"), 1), rating=f.num(p.get("my_rating_of_them"), 2)),
                           f("who.tip_cross", you=p.get("evaluated_by_me"), team=p.get("teammate"))])

    sections = [{
        "id": "who", "title": f("who.title"), "nav": f("nav.who"),
        "lede": f("who.lede", correctors=S["unique_correctors"], mutual=S["mutual"]) + (" " + f("who.lede_most", login=most["login"], n=most["outstanding_to_me"]) if most else ""),
        "legend": ch.legend([(f("flag.other"), ch.S1), (f("flag.outstanding"), ch.GOOD)]),
        "chart": ch.hbars(f, [p["login"] for p in top], [(f("flag.other"), [p["evaluated_me"] - p["outstanding_to_me"] for p in top], ch.S1),
                                                         (f("flag.outstanding"), [p["outstanding_to_me"] for p in top], ch.GOOD)],
                          label=f("who.top_title"), tips=[tip(p) for p in top], empty_text=f("empty.period"),
                          end=lambda i, v: str(v),
                          extra=lambda i: f"{top[i]['outstanding_to_me']} {f('flag.outstanding')}" if top[i]["outstanding_to_me"] else ""),
        "q": pg.q("q", "")[:80],
        "table": table(f, [
            {"k": "login", "t": f("col.login"), "nw": True, "f": lambda p: f'{avatar(p)}{escape(p["login"])}{" " + badge(f("who.staff")) if p.get("staff") else ""}'},
            {"k": "name", "t": f("col.name"), "cls": "name", "hide": True, "f": lambda p: f'<span title="{escape(p.get("name") or "")}">{escape(p.get("name") or "")}</span>'},
            {"k": "evaluated_me", "t": f("col.evaluated_you"), "num": True}, {"k": "outstanding_to_me", "t": f("col.outstanding"), "num": True},
            {"k": "avg_mark_to_me", "t": f("col.avg_mark"), "num": True, "hide": True, "f": lambda p: f.num(p.get("avg_mark_to_me"), 1)},
            {"k": "evaluated_by_me", "t": f("col.you_evaluated"), "num": True}, {"k": "teammate", "t": f("col.teammate"), "num": True, "hide": True},
            {"k": "my_rating_of_them", "t": f("col.ratings"), "num": True, "nw": True, "hide": True,
             "f": lambda p: f"{f.num(p.get('my_rating_of_them'), 2)} / {f.num(p.get('their_rating_of_me'), 2)}"},
            {"k": "projects_on_me", "t": f("col.details"), "cls": "details", "hide": True, "sv": lambda p: len(p["projects_on_me"]), "f": details},
        ], rows, label=f("who.people_title"), sort=("evaluated_me", -1), sticky=True)}]

    mode = pg.q("mode", "received", ("received", "given", "mix"))
    conn = (pg.data.get("connections") or {}).get(pg.period) or []
    href = lambda login: pg.url("evaluations", q=login, log="received") + "#log"  # noqa: E731
    height = max(260, min(520, 160 + 12 * len(conn)))  # few people, a short panel
    order = {g: i for i, g in enumerate(gr.GROUPS)}
    sections.append({
        "id": "connections", "title": f("connections.title"), "nav": f("nav.connections"), "lede": f("connections.lede"),
        "switches": [pg.seg("mode", [("received", f("connections.mode_received")), ("given", f("connections.mode_given")), ("mix", f("connections.mode_mix"))],
                            mode, label=f("connections.mode_label"), target="connections")],
        "legend": ch.legend([(f("connections.legend_received"), ch.S1), (f("connections.legend_given"), ch.S2)]),
        "wide": Markup(gr.bubbles(f, conn, mode, width=960, height=height, href=href)),
        "narrow": Markup(gr.bubbles(f, conn, mode, width=420, height=height, href=href)),
        "empty": f("connections.empty"),
        "table": table(f, [
            {"k": "login", "t": f("col.login"), "nw": True},
            {"k": "name", "t": f("col.name"), "cls": "name", "hide": True, "f": lambda p: escape(p.get("name") or "")},
            {"k": "group", "t": f("col.group"), "nw": True, "sv": lambda p: order.get(p["group"], 99), "f": lambda p: escape(f(f"groups.{p['group']}"))},
            {"k": "received", "t": f("col.received"), "num": True}, {"k": "given", "t": f("col.given"), "num": True},
            {"k": "last", "t": f("col.last"), "nw": True, "hide": True},
        ], conn, label=f("connections.title"), sort=("received", -1))})

    every = pg.data["periods"]["all"]
    net = pg.data.get("network") or {}
    if net.get("nodes"):
        net = circle_links(net, every["profile"]["login"], every["given"], every["received"])
    has = bool(net.get("links"))
    sections.append({"id": "circle", "title": f("network.title"), "nav": f("nav.network"), "lede": f("network.lede"),
                     "legend": Markup('<div class="legend">' + "".join(
                         f'<span><svg class="arrow-key {kind}" viewBox="0 0 30 10" aria-hidden="true"><line x1="{4 if kind == "both" else 1}" y1="5" x2="25" y2="5"/>'
                         + ('<path d="M1 5 L8 1.5 L8 8.5 Z"/>' if kind == "both" else "") + f'<path d="M29 5 L22 1.5 L22 8.5 Z"/></svg>{escape(label)}</span>'
                         for kind, label in (("one", f("network.one_way")), ("both", f("network.both")))) + "</div>"),
                     "wide": Markup(gr.ring(f, net, width=720, height=640, compact=False, uid="w")) if has else "",
                     "narrow": Markup(gr.ring(f, net, width=400, height=400, compact=True, uid="n")) if has else "",
                     "empty": f("network.empty")})

    tm = (D.get("insights") or {}).get("teammates") or []
    sections.append({"id": "teammates", "title": f("teammates.title"), "nav": f("nav.teammates"), "table": table(f, [
        {"k": "login", "t": f("col.login"), "nw": True}, {"k": "name", "t": f("col.name"), "hide": True, "f": lambda r: escape(r.get("name") or "")},
        {"k": "teams", "t": f("col.teams"), "num": True},
        {"k": "projects", "t": f("col.projects"), "sv": lambda r: len(r["projects"]), "f": lambda r: escape(", ".join(r["projects"]))},
    ], tm, label=f("teammates.title"), sort=("teams", -1), empty=f("teammates.none"))})
    return sections


# ---------- Campus ----------

def campus(pg: Page) -> list[dict]:
    f, D = pg.f, pg.D
    L, layout = D["logtime"], pg.data["layout"]
    top = L["seats"][0] if L["seats"] else None
    overlap = sum(s["seconds"] for s in L["seats"]) - L["total_seconds"]
    lede = (f("seats.lede_all" if pg.period == "all" else "seats.lede_period", total=f.hm(L["total_seconds"]), computers=f.plural(len(L["seats"]), "count.computers"),
              clusters=f.plural(len(L["clusters"]), "count.clusters")) + " "
            + f("seats.lede_top", seat=top["host"], hours=f.nb(top["hours"], "h"), sessions=f.plural(top["sessions"], "count.sessions"))
            + (" " + f("seats.lede_overlap", overlap=f.hm(overlap)) if overlap >= 60 else "")) if top else f("empty.sessions")
    info = {s["host"]: s for s in L["seats"]}
    plan, sc = gr.seat_plan(f, layout, {s["host"]: s["seconds"] for s in L["seats"]}, unit="h", to_unit=lambda v: v / 3600, anchor=True,
                            detail=lambda h, v: f'{h} · {f.nb(info[h]["hours"], "h")} · {f.plural(info[h]["sessions"], "count.sessions")} · {f.day(info[h]["first"])} → {f.day(info[h]["last"])}')
    best = max(top["hours"], 1e-9) if top else 1
    part = lambda s, i: (m.group(i) if (m := re.fullmatch(r"c(\d+)r(\d+)s(\d+)", s["host"])) else None)  # noqa: E731
    seat_link = lambda s: f'<a class="code" href="#seat-{escape(s["host"])}" title="{escape(f("computers.show_on_plan", seat=s["host"]))}">{escape(s["host"])}</a>'  # noqa: E731
    computers = table(f, [
        {"k": "host", "t": f("col.computer"), "f": seat_link},
        {"k": "cluster", "t": f("col.cluster"), "num": True, "hide": True, "sv": lambda s: int(part(s, 1) or 0), "f": lambda s: part(s, 1) or "–"},
        {"k": "row", "t": f("col.row"), "num": True, "hide": True, "sv": lambda s: int(part(s, 2) or 0), "f": lambda s: part(s, 2) or "–"},
        {"k": "seat", "t": f("col.seat"), "num": True, "hide": True, "sv": lambda s: int(part(s, 3) or 0), "f": lambda s: part(s, 3) or "–"},
        {"k": "hours", "t": f("col.hours"), "num": True, "nw": True,
         "f": lambda s: f'<span class="hbar" aria-hidden="true"><i style="width:{100 * s["hours"] / best:.1f}%"></i></span>{s["hours"]:.1f}'},
        {"k": "sessions", "t": f("col.sessions"), "num": True},
        {"k": "first", "t": f("col.first"), "nw": True, "hide": True}, {"k": "last", "t": f("col.last"), "nw": True, "hide": True},
    ], L["seats"], label=f("computers.table_aria"), sort=("hours", -1))
    keys = list(L["monthly"])
    daily = False
    labels, values = [], []
    if keys:
        y, mo = map(int, keys[0].split("-"))
        months = []
        while f"{y}-{mo:02d}" <= keys[-1]:
            months.append(f"{y}-{mo:02d}")
            y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
        daily = len(months) <= 2
        labels = [f"{int(d[8:])} {f.months[int(d[5:7]) - 1]}" for d in L["days"]] if daily else [f.month_label(m) for m in months]
        values = L["hours"] if daily else [L["monthly"].get(m, 0) for m in months]
    sections = [{"id": "seats", "title": f("seats.title"), "nav": f("nav.seats"), "count": f.plural(len(L["seats"]), "count.computers"), "lede": lede,
                 "plan": plan, "scale": sc, "computers": computers, "computers_title": f("computers.title"),
                 "monthly_title": f("seats.day_title" if daily else "seats.month_title"),
                 "monthly": ch.vbars(f, labels, [(f("unit.hours"), values, ch.S1)], label=f("seats.month_aria"), peak="{v} h · {label}",
                                     fmt=lambda v: f.num(v, 1), empty_text=f("empty.sessions"))}]

    busiest = max(zip(L["days"], L["hours"]), key=lambda x: x[1], default=None)
    cal, cal_scale = gr.calendar(f, L["days"], L["hours"])
    sections.append({"id": "days", "title": f("days.title"), "nav": f("nav.days"),
                     "lede": f("days.lede", days=f.plural(L["days_present"], "count.days"), first=f.day(L["first_day"]), last=f.day(L["last_day"]),
                               avg=f.hm(L["total_seconds"] / L["days_present"]), longest=f.nb(L["longest_session_h"], "h"),
                               busiest=f.day(busiest[0], weekday=True), busiest_h=f.nb(busiest[1], "h")) if L["days_present"] and busiest else f("empty.sessions"),
                     "calendar": cal, "calendar_scale": cal_scale, "heat": gr.heat(f, L["heat"], gr.AMBER, "h")})

    sq = pg.q("sq", "")[:80].lower()
    log = [s for s in L["log"] if not sq or sq in f"{s['begin']} {s.get('end')} {s['host']}".lower()]
    sections.append({"id": "sessions", "title": f("sessions.title"), "nav": f("nav.sessions"), "lede": f("sessions.lede"), "q": pg.q("sq", "")[:80],
                     "count": f("sessions.count", shown=f.num(len(log)), total=f.num(len(L["log"]))),
                     "table": table(f, [
                         {"k": "begin_ms", "t": f("col.logged_in"), "nw": True, "f": lambda s: escape(s["begin"])},
                         {"k": "seconds", "t": f("col.duration"), "num": True, "nw": True, "f": lambda s: f.hm(s["seconds"])},
                         {"k": "host", "t": f("col.computer"), "f": seat_link},
                         {"k": "end", "t": f("col.logged_out"), "nw": True, "hide": True, "f": lambda s: escape(s.get("end") or f("sessions.still_logged"))},
                     ], log, label=f("sessions.table_aria"), sort=("begin_ms", -1), empty=f("empty.search_sessions") if sq else f("empty.sessions"))})

    PL, S = D["place"], D["summary"]
    role = "mine" if pg.light else pg.q("where", "corrector", ("corrector", "mine"))
    values = PL["received_corrector_hosts"] if role == "corrector" else PL["my_eval_hosts"]
    who = f("where.tip_corrector" if role == "corrector" else "where.tip_mine")
    wplan, wscale = gr.seat_plan(f, layout, values, unit=f("unit.evals"), detail=lambda h, v: f'{h} · {f.plural(v, "count.evaluations")} · {who}')
    first = PL["received_my_cluster"] if pg.light else PL["received_corrector_cluster"]
    ckeys = sorted(set(first) | set(PL["given_my_cluster"]), key=lambda k: (k == "not logged", k))
    lab = lambda k: f("log.not_logged") if k == "not logged" else k  # noqa: E731
    first_name = f("where.you_evaluated" if pg.light else "where.corrector_evaluating")
    sections.append({"id": "where", "title": f("where.title"), "nav": f("nav.where"),
                     "lede": f("where.lede_light", me=PL["me_located_received"], n=S["received"], given=PL["me_located_given"], total_given=S["given"]) if pg.light
                     else f("where.lede", corrector=PL["corrector_located"], n=S["received"], me=PL["me_located_received"], same=PL["same_cluster"]),
                     "switch": "" if pg.light else pg.seg("where", [("corrector", f("where.role_corrector")), ("mine", f("where.role_mine"))], role,
                                                         label=f("where.role_label"), target="where"),
                     "plan": wplan, "scale": wscale, "legend": ch.legend([(first_name, ch.S1), (f("where.you_evaluating"), ch.S2)]),
                     "clusters": ch.vbars(f, [lab(k) for k in ckeys], [(first_name, [first.get(k, 0) for k in ckeys], ch.S1),
                                                                       (f("where.you_evaluating"), [PL["given_my_cluster"].get(k, 0) for k in ckeys], ch.S2)],
                                          label=f("where.clusters_title"), fmt=f.num, empty_text=f("empty.period"))})
    return sections


# ---------- Astra Victoris ----------

def astra(pg: Page) -> list[dict]:
    f = pg.f
    v = av.view(f, pg.data)
    gk = v["gatekeeper"]

    def bar(have, need, label, fmt=lambda x: f.num(x)):
        return {"label": label, "have": fmt(have), "need": fmt(need), "pct": min(100, round(100 * have / need)) if need else 0, "met": have >= need}

    goals = []
    for g in av.GOALS:
        goal = {"key": g, "name": f(f"astra.goal.{g}.name"), "rule": f(f"astra.goal.{g}.rule"), "hex": av.hexagon(g, f(f"astra.goal.{g}.name"))}
        if g in ("grandmaster", "architect"):
            goal.update(auto=v[g]["met"], options=v[g]["options"])
        elif g == "gatekeeper":
            goal.update(auto=gk["met"], bars=[
                bar(gk["outer"], 50, f("astra.gk.outer")),
                bar(gk["total"], 150, f("astra.gk.total")),
                bar(gk["hours"], 2000, f("astra.gk.hours_intra" if gk["official"] else "astra.gk.hours"), lambda x: f.nb(x, "h", 0))],
                avg=f("astra.gk.avg", avg=f.num(gk["avg"], 2)) if gk["avg"] is not None else "")
        else:
            goal["auto"] = None
            if g == "titan" and v["titan"]:
                c = v["titan"]
                goal["auto"] = c["met"]
                goal["coalition"] = " · ".join(x for x in [c["name"], f("astra.coal.rank", n=c["rank"]) if c["rank"] else "",
                                                          f("astra.coal.score", n=f.num(c["score"])) if c["score"] is not None else "",
                                                          f("astra.coal.master") if c["master"] else ""] if x)
            goal["counters"] = {"kraken": [("babel", f("astra.kraken.babel"), 5), ("manguito", f("astra.kraken.manguito"), 3)],
                                "headhunter": [("alumni", f("astra.hh.events"), 4)]}.get(g, [])
            goal["switches"] = {"headhunter": [("referral", f("astra.hh.referral"))],
                                "titan": [("tool", f("astra.titan.tool")), ("scorer", f("astra.titan.scorer"))]}.get(g, [])
        goals.append(goal)
    auto_done = sum(1 for g in goals if g["auto"])
    return [{"id": "astra", "title": f("astra.title"), "nav": f("astra.title"), "lede": f("astra.lede"), "goals": goals,
             "count": f("astra.count", n=auto_done), "laurel": av.laurel(), "laurel_flip": av.laurel(flip=True)}]


BUILDERS = {"home": home, "projects": projects, "evaluations": evaluations, "people": people, "campus": campus, "astra": astra}
