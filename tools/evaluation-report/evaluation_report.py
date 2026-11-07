#!/usr/bin/env python3
"""The evaluation history of one 42 student as a single HTML page: the profile in short, every project, and each
attempt of Milestone 6, Outer Core and the projects handed in again (correctors, times, seats).

It asks for the login, extracts it with the server's own code (server/cmd/devtools, about 130 requests; a saved
extraction under an hour old is reused, as the app does) and looks up the correctors' seats the extraction leaves out
(it covers 60 days): one request per evaluation, saved so they are asked once.

Local only: the page and everything in data/ name other students. Both folders are git-ignored and private (mode 600).

    python3 tools/evaluation-report/evaluation_report.py [--fresh]
    python3 tools/evaluation-report/evaluation_report.py --report FILE --out FILE   # a saved report, no prompt, no API
"""
import argparse
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from math import ceil
from pathlib import Path
from statistics import mean, median

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
DATA = HERE / "data"
OUT = HERE / "out"
API_URL = "https://api.intra.42.fr"
MIN_INTERVAL = 0.52  # the app limit is 2 requests per second
REUSE_SECONDS = 3600  # one extraction per user per hour, like the app
HIDDEN = "Hidden"  # how an opted-out student appears, as in server/internal/web/hide.go
USER_AGENT = "ravazque-info-evaluation-report"  # the API answers 403 to Python's default one

MONTHS = "ene feb mar abr may jun jul ago sep oct nov dic".split()
STATUS = {"finished": "Terminado", "in_progress": "En curso", "waiting_for_correction": "Esperando corrección",
          "searching_a_group": "Buscando grupo", "creating_group": "Creando grupo"}
NO_MARK = {"pending": "Pendiente", "absent_you": "No se presentó el alumno", "absent_them": "No se presentó el corrector",
           "unfinished": "Proyecto sin terminar", "closed": "Proyecto cerrado"}
GROUPS = {"rank-00": "Milestone 0", "rank-01": "Milestone 1", "rank-02": "Milestone 2", "rank-03": "Milestone 3",
          "rank-04": "Milestone 4", "rank-05": "Milestone 5", "rank-06": "Milestone 6", "outer-core": "Outer Core",
          "piscine": "Piscina"}
# Common Core projects handed in again from the Outer Core: their new attempts belong with the rest of this history
HANDED_IN_AGAIN = ("minirt", "born2beroot")
OUTCOMES = {"out": "Outstanding", "ok": "100 o más", "low": "Menos de 100 o marca negativa", "none": "Sin nota"}
ICONS = {"out": '<path d="M5 0 10 5 5 10 0 5Z" fill="var(--accent-data)"/>',
         "ok": '<circle cx="5" cy="5" r="4" fill="var(--ink)"/>',
         "low": '<path d="M1 1 9 9M9 1 1 9" stroke="var(--critical)" stroke-width="2.5" fill="none"/>',
         "none": '<circle cx="5" cy="5" r="3.5" stroke="var(--neutral)" stroke-width="1.5" fill="none"/>',
         "yes": '<path d="M1 5.5 4 8.5 9 2" stroke="var(--good)" stroke-width="2.2" fill="none"/>',
         "no": '<path d="M1.5 1.5 8.5 8.5M8.5 1.5 1.5 8.5" stroke="var(--critical)" stroke-width="2.2" fill="none"/>',
         "open": '<circle cx="5" cy="5" r="3.5" stroke="var(--neutral)" stroke-width="1.5" fill="none"/>',
         "in": '<circle cx="5" cy="5" r="3" fill="var(--text-2)"/>'}


class LookupFailed(Exception):
    pass


def selected(projects):
    return [p for p in projects if p["group"] == "outer-core" or (p["group"] == "rank-06" and not p.get("exam"))
            or any(name in p["slug"] for name in HANDED_IN_AGAIN)]


def detail_groups(projects):
    named = {"rank-06": "Milestone 6", "outer-core": "Outer Core"}
    groups = [(title, [p for p in projects if p["group"] == key]) for key, title in named.items()]
    groups.append(("Reentregas de milestones anteriores", [p for p in projects if p["group"] not in named]))
    return [(title, ps) for title, ps in groups if ps]


def valid_login(login):
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9-]{0,31}", login))


def parse_env(text):
    """KEY=value lines of the root .env (compose format: it cannot be sourced by a shell)."""
    pairs = (line.split("=", 1) for line in text.splitlines() if "=" in line and not line.lstrip().startswith("#"))
    return {k.strip(): v.strip().strip("\"'") for k, v in pairs}


def optouts():
    """The logins in OPTOUT_LOGINS of the root .env: students who asked not to appear in anyone's report."""
    env = parse_env((REPO / ".env").read_text()) if (REPO / ".env").exists() else {}
    return {x.strip().lower() for x in env.get("OPTOUT_LOGINS", "").split(",") if x.strip()}


def is_hidden(login):
    return re.fullmatch(rf"{HIDDEN}( \d+)?", login or "") is not None


def hide(v, logins, own):
    """A copy with every opted-out student a label with no name, photo or seat, as the app's hide.go does: the number only
    tells them apart inside this report, so no count changes. The student of the report never is."""
    gone = lambda x: x.lower() in logins and x.lower() != own.lower()
    labels = {}
    # a copy hidden before keeps its numbers: the new ones come after them
    used = max((int(n) for n in re.findall(rf"{HIDDEN} (\d+)", json.dumps(v))), default=0)

    def label(login):
        if login.lower() not in labels:
            labels[login.lower()] = f"{HIDDEN} {used + len(labels) + 1}"
        return labels[login.lower()]

    def walk(x):
        if isinstance(x, list):
            return [walk(e) for e in x]
        if isinstance(x, str):  # also inside a text: a team's "peer's group", a comment
            return re.sub(r"[A-Za-z0-9-]+", lambda m: label(m.group()) if gone(m.group()) else m.group(), x)
        if not isinstance(x, dict):
            return x
        out = {label(k) if gone(k) else k: walk(e) for k, e in x.items()}
        if isinstance(x.get("login"), str) and gone(x["login"]):
            out.update({k: None for k in ("name", "image", "displayname", "host", "hosts") if k in out})
        people = [out.get("corrector"), *(out.get("correcteds") or [])]
        if "other_host_checked" in out and any(isinstance(p, dict) and is_hidden(p.get("login")) for p in people):
            out["other_host_checked"] = False
            if "other_host" in out:
                out["other_host"] = None
        return out

    return walk(v)


class ApiError(Exception):
    def __init__(self, status):
        super().__init__(f"42 API answered {status}")
        self.status = status


class Api:
    """The 42 API with the app in the root .env: client credentials, 2 requests/s, retries on 429 and 5xx."""

    def __init__(self):
        env = parse_env((REPO / ".env").read_text()) if (REPO / ".env").exists() else {}
        self.uid, self.secret = env.get("FT_UID"), env.get("FT_SECRET")
        if not self.uid or not self.secret:
            sys.exit("Missing FT_UID and FT_SECRET: fill them in the root .env")
        self.token, self.last, self.calls = None, 0.0, 0

    def _open(self, request):
        return urllib.request.urlopen(request, timeout=60)

    def _auth(self):
        body = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": self.uid, "client_secret": self.secret})
        try:
            with self._open(urllib.request.Request(f"{API_URL}/oauth/token", body.encode(), {"User-Agent": USER_AGENT})) as r:
                self.token = json.load(r)["access_token"]
        except urllib.error.HTTPError as err:
            sys.exit(f"The 42 API answered {err.code} when asked for a token: check FT_UID and FT_SECRET in the root .env")

    def _get(self, path, params):
        if not self.token:
            self._auth()
        url = f"{API_URL}{path}?{urllib.parse.urlencode(params)}"
        for attempt in range(6):
            time.sleep(max(0, MIN_INTERVAL - (time.monotonic() - self.last)))
            self.last = time.monotonic()
            self.calls += 1
            headers = {"Authorization": f"Bearer {self.token}", "User-Agent": USER_AGENT}
            try:
                with self._open(urllib.request.Request(url, headers=headers)) as r:
                    return json.load(r), r.headers
            except urllib.error.HTTPError as err:
                if err.code == 401 and attempt == 0:
                    self._auth()
                elif err.code == 429 or err.code >= 500:
                    time.sleep(float(err.headers.get("Retry-After") or 2 ** attempt))
                else:
                    raise ApiError(err.code) from err
        raise ApiError("too many retries")

    def get(self, path, **params):
        return self._get(path, params)[0]

    def get_all(self, path, **params):
        items, page = [], 1
        while True:
            batch, headers = self._get(path, {**params, "page[size]": 100, "page[number]": page})
            items.extend(batch)
            if len(batch) < 100 or len(items) >= int(headers.get("X-Total") or 0):
                return items
            page += 1


def seat_at(sessions, start_ms, end_ms):
    """The seat with the longest login inside the window, as the app does (core.SessionHost); None = not logged."""
    best, best_overlap = None, 0
    for s in sessions:
        begin = datetime.fromisoformat(s["begin_at"]).timestamp() * 1000
        end = datetime.fromisoformat(s["end_at"]).timestamp() * 1000 if s.get("end_at") else time.time() * 1000
        if (overlap := min(end, end_ms) - max(begin, start_ms)) > best_overlap:
            best, best_overlap = s["host"], overlap
    return best


def window(e):
    """Begin to the form being filled, or the planned length when it never was (core's report.window)."""
    filled = e.get("filled_ms")
    return e["begin_ms"], filled if filled and filled > e["begin_ms"] else e["begin_ms"] + e["planned_min"] * 60000


def corrector_seats(evals, cache, lookup):
    """{evaluation id: seat or None}; an evaluation missing here was never looked up ("Sin datos")."""
    seats = {}
    for e in evals:
        key = str(e["id"])
        if is_hidden(e["corrector"]["login"]):  # never asked, and one saved before they opted out goes
            cache.pop(key, None)
        elif e["other_host_checked"]:
            seats[e["id"]] = e["other_host"]
        elif key in cache:
            seats[e["id"]] = cache[key]
        elif lookup:
            try:
                seats[e["id"]] = cache[key] = seat_at(lookup(e), *window(e))
            except LookupFailed:
                pass
    return seats


def outcome(e):
    if e["mark"] is None:
        return "none"
    if e["negative_flag"] or e["mark"] < 100:
        return "low"
    return "out" if e["outstanding"] else "ok"


def state(x):
    """(icon, text) saying where a project or attempt stands."""
    live = STATUS.get(x["status"], x["status"])
    if x["validated"] is None:
        return "open", live
    kind, text = ("yes", "Validado") if x["validated"] else ("no", "No validado")
    return kind, text if x["status"] == "finished" else f"{text} · {live.lower()}"


def axis_start(starts):
    """First month of the chart: the odd attempt over six months older than the next stays off it (at most one in ten),
    or all the others would be squeezed into a corner."""
    ordered = sorted(starts)
    kept = 0
    while kept < max(1, len(ordered) // 10) and kept + 1 < len(ordered) and ordered[kept + 1] - ordered[kept] > timedelta(days=183):
        kept += 1
    return ordered[kept].replace(day=1, hour=0, minute=0)


def spread(xs, gap):
    """Marks that share a day, pushed apart just enough to tell them apart."""
    out = []
    for x in xs:
        out.append(max(x, out[-1] + gap) if out else x)
    return out


def esc(v):
    return html.escape(str(v))


def parse(s):
    return datetime.strptime(s, "%Y-%m-%d %H:%M") if s else None


def date(s):
    """2026-09-28 18:00 → 28 sep 2026 18:00"""
    return f"{(d := parse(s)).day} {MONTHS[d.month - 1]} {d.year} {d:%H:%M}" if s else "–"


def day(s):
    """2026-09-28 18:00 → 28 sep 18:00 (the attempt above gives the year)"""
    return f"{(d := parse(s)).day} {MONTHS[d.month - 1]} {d:%H:%M}" if s else "–"


def num(v, digits=1):
    return "–" if v is None else f"{v:.{digits}f}".replace(".", ",")


def thousands(n):
    return f"{n:,}".replace(",", ".")


def span(minutes):
    """A length in the unit that reads best."""
    if minutes is None:
        return "–"
    if abs(minutes) < 90:
        return f"{num(minutes, 0)}m"
    return f"{num(minutes / 60)}h" if abs(minutes) < 2880 else f"{num(minutes / 1440)} días"


def icon(kind):
    return f'<svg class="mk" viewBox="0 0 10 10" aria-hidden="true">{ICONS[kind]}</svg>'


def person(c):
    login = c["login"]
    if re.fullmatch(r"3b3-\d+", login):
        return "–", "Cuenta borrada"
    name = " ".join((c.get("name") or "").split()[:2])
    return login, name + (" · staff" if c.get("staff") else "")


def figure(value, label, note=""):
    return f'<div class="fig"><b>{esc(value)}</b><span>{esc(label)}</span><small>{esc(note)}</small></div>'


def section(id_, title, intro, body):
    lead = f'<p class="intro">{esc(intro)}</p>' if intro else ""
    return f'<section id="{id_}"><h2>{esc(title)}</h2>{lead}{body}</section>'


def palette():
    """The site's colours (ui.json) for both themes; dark never prints."""
    tokens = json.loads((REPO / "server/core/data/ui.json").read_text())["tokens"]
    names = "ground sunken ink text-2 muted rule accent on-accent accent-data slate good critical neutral".split()
    theme = lambda t: ";".join(f"--{name}:{t[name]}" for name in names)
    return f":root{{{theme(tokens['light'])}}}@media screen and (prefers-color-scheme:dark){{:root{{{theme(tokens['dark'])}}}}}"


def td(label, content, cls=""):
    """A cell that carries its column's name: narrow screens stack the row and show it."""
    return f'<td{f" class={chr(34)}{cls}{chr(34)}" if cls else ""} data-l="{esc(label)}">{content}</td>'


def profile(doc):
    s = doc["periods"]["student"]
    sm, lt, who = s["summary"], s["logtime"], s["profile"]
    cursus = next((c for c in s["extras"]["cursus"] if c["name"] == "42cursus"), {})
    exams = (s.get("insights") or {}).get("exams") or []
    promo, coal = doc.get("promo") or {}, who.get("coalition") or {}
    since = parse(cursus.get("begin"))
    points = s["correction_points"]
    facts = [f"Campus {who.get('campus_current') or '–'}", f"Wallet {who['wallet']}",
             f"Puntos de corrección {who['correction_point']} (ganados {points['earned']}, gastados {points['spent']})",
             f"{sm['unique_correctors']} correctores distintos", f"{sm['unique_evaluated']} personas evaluadas"]
    figures = "".join((
        figure(num(cursus.get("level"), 2), "Nivel en 42cursus",
               f"{cursus.get('grade') or '–'}{f' · desde {MONTHS[since.month - 1]} {since.year}' if since else ''}"),
        figure(f"{promo['rank']} de {promo['size']}" if promo else "–", "Puesto en la promoción",
               f"percentil {num(promo['percentile'])}" if promo else ""),
        figure(f"{sm['validated']} de {sm['projects']}", "Proyectos validados", f"{sm['attempts']} intentos · {sm['retries']} reintentos"),
        figure(f"{sum(bool(x['passed']) for x in exams)} de {len(exams)}", "Exámenes aprobados", f"{sum(x['attempts'] for x in exams)} intentos"),
        figure(sm["received"], "Evaluaciones recibidas", f"{sm['received_outstanding']} outstanding"),
        figure(sm["given"], "Evaluaciones dadas", f"{sm['given_outstanding']} outstanding"),
        figure(f"{lt['total_hours']:.0f}h", "Tiempo logeado", f"{lt['days_present']} días · {lt['sessions']} sesiones"),
        figure(coal.get("name") or "–", "Coalición",
               f"puesto {coal['rank']} · {thousands(coal['score'])} puntos" if coal else ""),
    ))
    return section("perfil", "Perfil", "Cifras desde que empezó 42cursus, sin contar la piscina.",
                   f'<div class="figs">{figures}</div><p class="facts">{esc(" · ".join(facts))}</p>')


def all_projects(projects, detailed):
    by_group = defaultdict(list)
    for p in projects:
        by_group[p["group"]].append(p)
    order = [g for g in GROUPS if g in by_group] + [g for g in by_group if g not in GROUPS]
    blocks = []
    for g in order:
        rows = []
        for p in by_group[g]:
            kind, text = state(p)
            name = f'<a href="#p-{esc(p["slug"])}">{esc(p["name"])}</a>' if p["slug"] in detailed else esc(p["name"])
            rows.append(f'<tr><th>{name}</th>{td("Estado", f"{icon(kind)} {esc(text)}", "wide")}'
                        f'{td("Nota", esc(p["mark"]) if p["mark"] is not None else "–", "n")}{td("Intentos", len(p["attempts"]), "n")}'
                        f'{td("Evaluaciones", p["evals"] or "–", "n")}{td("Días", num(p["days_to_validate"]), "n")}</tr>')
        done = sum(p["validated"] is True for p in by_group[g])
        blocks.append(f'<div class="block"><h3>{esc(GROUPS.get(g, g))} <small>{done} de {len(by_group[g])} validados</small></h3>'
                      '<table class="plain"><thead><tr><th>Proyecto</th><th>Estado</th><th class="n">Nota</th><th class="n">Intentos</th>'
                      f'<th class="n">Evaluaciones</th><th class="n">Días</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div>')
    return section("proyectos", "Todos los proyectos",
                   "Días: de la inscripción a la validación. Los proyectos enlazados tienen su ficha más abajo.",
                   f'<div class="blocks">{"".join(blocks)}</div>')


def detail_figures(attempts, evals, seats, after):
    durations = [e["duration_min"] for e in evals if e["duration_min"] is not None]
    leads = [e["lead_h"] for e in evals if e["lead_h"] is not None]
    firsts = {e["team_id"]: e for e in reversed(evals)}.values()  # evals are in date order
    gaps = [after[e["id"]] for e in firsts if after[e["id"]] is not None]
    known = [e for e in evals if e["id"] in seats]
    same = sum(1 for e in known if seats[e["id"]] and e["my_host"]
               and seats[e["id"]].split("r")[0] == e["my_host"].split("r")[0])
    short = sum(1 for e in evals if e["duration_min"] is not None and e["duration_min"] < e["planned_min"] / 2)
    planned = median(e["planned_min"] for e in evals) if evals else None
    good, bad = sum(a["validated"] is True for a in attempts), sum(a["validated"] is False for a in attempts)
    return "".join((
        figure(len(attempts), "Intentos", f"{good} validados · {bad} no validados · {len(attempts) - good - bad} abiertos"),
        figure(len(evals), "Evaluaciones", f"{sum(e['outstanding'] for e in evals)} outstanding"),
        figure(len({e['corrector']['login'] for e in evals}), "Correctores distintos"),
        figure(span(median(durations)) if durations else "–", "Duración mediana",
               f"prevista {span(planned)} · {short} por debajo de la mitad"),
        figure(span(median(leads) * 60) if leads else "–", "Antelación mediana", "de agendar a empezar"),
        figure(span(median(gaps)) if gaps else "–", "De la entrega a la primera evaluación", "mediana por intento"),
        figure(f"{sum(bool(e['my_host']) for e in evals)} de {len(evals)}", "Alumno logeado", "durante la evaluación"),
        figure(f"{sum(bool(seats[e['id']]) for e in known)} de {len(known)}", "Corrector logeado", f"{same} en el mismo clúster"),
    ))


def attempt_row(p, a, evs, pct, now):
    start, closed = parse(a["start"]), parse(a["closed"])
    end = closed or now
    kind, result = state(a)
    if pct(end) < 0:
        plot = f'<span class="before">Anterior a la gráfica: {esc(date(a["start"]))}</span>'
    else:
        left = max(pct(start), 0)
        plot = f'<i class="bar{"" if closed else " open"}" style="left:{left:.2f}%;width:{pct(end) - left:.2f}%"></i>'
        # dodged in pixels of a laptop's plot, so marks of one day stay apart at every width without moving far from it
        px = 9.0
        shown = [e for e in evs if pct(parse(e["begin"])) >= 0]
        clear = (pct(end) * px + 9) if closed else 0
        xs = [pct(parse(e["begin"])) * px for e in shown]
        for e, x, cx in zip(shown, xs, spread([max(v, clear) for v in xs], 15)):
            login, _ = person(e["corrector"])
            tip = f"{login} · {date(e['begin'])} · {span(e['duration_min'])} · {OUTCOMES[outcome(e)]}"
            plot += f'<span class="dot" style="left:min(calc({x / px:.2f}% + {cx - x:.0f}px),calc(100% - 7px))" title="{esc(tip)}">{icon(outcome(e))}</span>'
    mark = f"{a['mark']} · " if a["mark"] is not None else ""
    title = f"{p['name']}, intento {a['n']}: inscripción {date(a['start'])}, entrega {date(a['closed'])}"
    return (f'<a class="att" href="#p-{esc(p["slug"])}" title="{esc(title)}"><span class="att-n">{a["n"]} de {len(p["attempts"])}</span>'
            f'<span class="plot">{plot}</span><span class="res">{icon(kind)} {esc(mark + result)}</span></a>')


def chart(groups, by_team, now):
    attempts = [a for _, ps in groups for p in ps for a in p["attempts"]]
    evals = [e for es in by_team.values() for e in es]
    first = axis_start([parse(a["start"]) for a in attempts])
    latest = max([now] + [parse(e["begin"]) for e in evals])
    last = (latest.replace(day=1, hour=0, minute=0) + timedelta(days=32)).replace(day=1)
    pct = lambda d: 100 * ((d - first) / (last - first))

    months, m = [], first
    while m < last:
        months.append(m)
        m = (m + timedelta(days=32)).replace(day=1)
    every = ceil(len(months) / 12)  # about twelve labels fit a laptop, a phone keeps one in three of them
    labelled = months[::every]
    axis = "".join(f'<span class="{"" if i % 3 == 0 else "minor"}" style="left:{pct(m):.2f}%">{MONTHS[m.month - 1]}'
                   f'{f" {m.year}" if i == 0 or m.month == 1 else ""}</span>' for i, m in enumerate(labelled))
    lines = [f"linear-gradient(var(--rule),var(--rule)) {pct(m):.2f}% 0/1px 100% no-repeat" for m in labelled]
    lines.insert(0, f"linear-gradient(var(--accent-data),var(--accent-data)) {pct(now):.2f}% 0/2px 100% no-repeat")

    body = []
    for title, ps in groups:
        body.append(f'<div class="chart-group">{esc(title)}</div>')
        for p in ps:
            rows = "".join(attempt_row(p, a, by_team[a["team_id"]], pct, now) for a in p["attempts"])
            body.append(f'<div class="proj"><a class="pname" href="#p-{esc(p["slug"])}" title="{esc(p["name"])}">{esc(p["name"])}</a>'
                        f'<div>{rows}</div></div>')
    key = "".join(f"<li>{icon(k)} {esc(v)}</li>" for k, v in OUTCOMES.items())
    head = (f'<div class="chart-head"><span>Proyecto</span><span>Intento</span><span class="axis">{axis}</span>'
            '<span class="res-h">Nota y resultado</span></div>')
    foot = f'<div class="chart-foot"><span class="axis"><span style="left:{pct(now):.2f}%">Hoy, {esc(day(now.strftime("%Y-%m-%d %H:%M")))}</span></span></div>'
    return (f'<ul class="key"><li><i class="sw"></i> De la inscripción a la entrega</li><li><i class="sw open"></i> Sin entregar</li>{key}</ul>'
            f'<div class="chart" style="--grid:{",".join(lines)}">{head}{"".join(body)}{foot}</div>')


def seat_cell(label, host, known=True):
    if not known:
        return f'<td class="seat none" data-l="{label}">Sin datos</td>'
    if not host:
        return f'<td class="seat off" data-l="{label}">{icon("none")} No logeado</td>'
    return f'<td class="seat on" data-l="{label}">{icon("in")} {esc(host)}</td>'


def evaluation_rows(e, seats, after, max_min, max_lead):
    login, name = person(e["corrector"])
    kind = outcome(e)
    flag = "OK" if e["flag"] == "Ok" else (e["flag"] or "").replace(" project", "")
    result = f"{e['mark']} · {flag}" if e["mark"] is not None else NO_MARK.get(e["no_mark"], "Sin nota")
    dur, lead = e["duration_min"], e["lead_h"]
    meter_lead = f'<span class="meter"><i style="width:{100 * (lead or 0) / max_lead:.1f}%"></i></span>'
    meter_dur = (f'<span class="meter"><i style="width:{100 * max(dur or 0, 0) / max_min:.1f}%"></i>'
                 f'<u style="left:{100 * e["planned_min"] / max_min:.1f}%"></u></span>')
    took = f"{span(dur)} de {e['planned_min']}m" if dur is not None else "Sin rellenar"
    said = [f"<p><b>Comentario del corrector.</b> {esc(e['comment'])}</p>"] if e["comment"] else []
    said += [f"<p><b>Valoración del alumno, {esc(f['rating'])} de 5.</b> {esc(f['comment'] or '')}</p>" for f in e["feedbacks"]]
    note = f'<tr class="note"><td colspan="9">{"".join(said)}</td></tr>' if said else ""
    return (f'<tbody class="ev"><tr><th title="{esc(name)}">{esc(login)} <small>{esc(name)}</small></th>'
            f'{td("Empezó", esc(day(e["begin"])))}{td("Agendada", esc(day(e["booked"])))}'
            f'{td("Antelación", meter_lead + esc(span(lead * 60) if lead is not None else "–"))}'
            f'{td("Tras la entrega", esc(span(after[e["id"]])))}{td("Duración", meter_dur + esc(took))}'
            f'{td("Nota", f"{icon(kind)} {esc(result)}")}'
            f'{seat_cell("Asiento del alumno", e["my_host"])}{seat_cell("Asiento del corrector", seats.get(e["id"]), e["id"] in seats)}'
            f'</tr>{note}</tbody>')


def steps(a, evs):
    points = [("Inscripción", a["start"]), ("Grupo bloqueado", a["locked"]), ("Entrega", a["closed"])]
    if evs:
        points.append(("Primera evaluación", evs[0]["begin"]))
    if len(evs) > 1:
        points.append(("Última evaluación", evs[-1]["begin"]))
    items, before = [], None
    for label, when in points:
        gap = f'<em>+{esc(span((parse(when) - before).total_seconds() / 60))}</em>' if when and before else ""
        shown = date(when) if when else "Sin entregar" if label == "Entrega" else "–"
        items.append(f"<li><small>{label}</small><b>{esc(shown)}</b>{gap}</li>")
        before = parse(when) or before
    return f'<ol class="steps">{"".join(items)}</ol>'


def sheets(groups, by_team, seats, after):
    evals = [e for es in by_team.values() for e in es]
    max_min = max([1] + [max(e["duration_min"] or 0, e["planned_min"]) for e in evals])
    max_lead = max([1] + [e["lead_h"] or 0 for e in evals])
    cols = "".join(f'<col class="c{i}">' for i in range(9))
    head = ("<thead><tr><th>Corrector</th><th>Empezó</th><th>Agendada</th><th>Antelación</th><th>Tras la entrega</th>"
            "<th>Duración</th><th>Nota</th><th>Asiento del alumno</th><th>Asiento del corrector</th></tr></thead>")
    out = []
    for title, ps in groups:
        out.append(f'<h3 class="group-title">{esc(title)}</h3>')
        for p in ps:
            kind, text = state(p)
            total = len(p["attempts"])
            parts = [f'<header><h4>{esc(p["name"])}</h4><p>{icon(kind)} {esc(text)} · {total} intento{"s" if total != 1 else ""}</p>'
                     f'<p class="final"><b>{esc(p["mark"]) if p["mark"] is not None else "–"}</b> nota final</p></header>']
            for a in p["attempts"]:
                evs = by_team[a["team_id"]]
                k, t = state(a)
                mates = ", ".join(a["members"])
                team = f"Con {mates}{' · líder: el alumno' if a['leader'] else ''}" if mates else "En solitario"
                mark = f" · nota {a['mark']}" if a["mark"] is not None else ""
                table = (f'<table class="ledger"><colgroup>{cols}</colgroup>{head}'
                         f'{"".join(evaluation_rows(e, seats, after, max_min, max_lead) for e in evs)}</table>'
                         if evs else '<p class="empty">Sin evaluaciones.</p>')
                parts.append(f'<article><h5>Intento {a["n"]} de {total}</h5><p class="who">{icon(k)} {esc(t + mark)} · {esc(team)}</p>'
                             f'{steps(a, evs)}{table}</article>')
            out.append(f'<div class="sheet" id="p-{esc(p["slug"])}">{"".join(parts)}</div>')
    terms = (("Antelación", "De agendar la evaluación a su hora de inicio."),
             ("Tras la entrega", "De la entrega a la hora de inicio de la evaluación."),
             ("Duración", "De la hora de inicio a cuando se rellenó el formulario, frente a los minutos previstos (la raya vertical). "
                          "Si se rellena tarde o antes de acabar, se aparta de lo que duró de verdad."),
             ("Entrega", "El cierre del equipo (closed_at): la API no tiene un campo «entregado»."),
             ("Asientos", "El puesto con más tiempo de sesión durante la evaluación. La API no dice en cuál se hizo, por eso salen los dos."),
             ("No logeado", "Sin sesión en ningún puesto durante la evaluación. «Sin datos» significa que no se pudo consultar."))
    glossary = "".join(f"<div><dt>{a}</dt><dd>{esc(b)}</dd></div>" for a, b in terms)
    toggle = '<label class="toggle"><input type="checkbox" id="notes" checked> Mostrar comentarios</label>'
    return section("intentos", "Intento a intento", "", f'<dl class="terms">{glossary}</dl>{toggle}{"".join(out)}')


def correctors(evals):
    rows = defaultdict(list)
    for e in evals:
        rows[e["corrector"]["login"]].append(e)
    out = []
    for es in sorted(rows.values(), key=lambda es: (-len(es), es[0]["corrector"]["login"])):
        login, name = person(es[0]["corrector"])
        marks = [e["mark"] for e in es if e["mark"] is not None]
        durations = [e["duration_min"] for e in es if e["duration_min"] is not None]
        names = sorted({e["project"] for e in es})
        out.append(f'<tr><th>{esc(login)} <small>{esc(name)}</small></th>{td("Veces", len(es), "n")}{td("Proyectos", esc(", ".join(names)), "wide")}'
                   f'{td("Nota media", num(mean(marks) if marks else None, 0), "n")}{td("Duración media", esc(span(mean(durations)) if durations else "–"), "n")}</tr>')
    table = ('<table class="plain people"><thead><tr><th>Corrector</th><th class="n">Veces</th><th>Proyectos</th><th class="n">Nota media</th>'
             f'<th class="n">Duración media</th></tr></thead><tbody>{"".join(out)}</tbody></table>')
    return section("correctores", "Correctores", "Quién ha corregido las evaluaciones en detalle, de más a menos veces.", table)


def render(doc, seats):
    rep = doc["periods"]["all"]
    projects = selected(rep["projects"])
    attempts = [a for p in projects for a in p["attempts"]]
    teams = {a["team_id"]: a for a in attempts}
    evals = sorted((e for e in rep["received"] if e["team_id"] in teams), key=lambda e: e["begin_ms"])
    by_team = defaultdict(list)
    after = {}
    for e in evals:
        by_team[e["team_id"]].append(e)
        closed = parse(teams[e["team_id"]]["closed"])
        after[e["id"]] = (parse(e["begin"]) - closed).total_seconds() / 60 if closed else None
    who = doc["periods"]["student"]["profile"]
    now = parse(rep["generated"])
    groups = detail_groups(projects)
    toc = "".join(f'<a href="#{i}">{t}</a>' for i, t in (
        ("perfil", "Perfil"), ("proyectos", "Todos los proyectos"), ("detalle", "Evaluaciones en detalle"),
        ("intentos", "Intento a intento"), ("correctores", "Correctores"), ("fuente", "Fuente")))
    detail = section("detalle", "Evaluaciones en detalle", "Cada fila es un intento y sus marcas son las evaluaciones; las que caen el mismo día "
                     "se separan un poco para que se vean. Pasa el ratón por una marca para ver quién y cuándo, o pulsa la fila para ir a su ficha.",
                     f'<div class="figs">{detail_figures(attempts, evals, seats, after)}</div>{chart(groups, by_team, now) if attempts else ""}')
    source = section("fuente", "Fuente", "", '<ul class="notes"><li>Datos de la API de 42, extraídos el '
                     f'{esc(date(rep["generated"]))}. Fechas en hora de Madrid.</li>'
                     "<li>Este informe contiene datos de otros estudiantes: nombres, comentarios y asientos. Es privado: no lo publiques.</li></ul>")
    fonts = (REPO / "web/src/styles/fonts.css").read_text()
    return f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe de {esc(who['login'])}</title>
<style>{fonts}{palette()}{CSS}</style></head><body>
<div class="band">Informe privado: contiene datos de otros estudiantes</div>
<header class="top"><h1>Informe de {esc(who['login'])}</h1>
<p>{esc(who.get('name') or '')} · Datos del {esc(date(rep['generated']))}</p></header>
<nav class="toc" aria-label="Secciones">{toc}</nav>
<main>{profile(doc)}{all_projects(rep['projects'], {p['slug'] for p in projects})}{detail}{sheets(groups, by_team, seats, after)}{correctors(evals)}{source}</main>
</body></html>
"""


CSS = """
:root{color-scheme:light dark;--gutter:clamp(16px,3vw,40px)}
*{box-sizing:border-box}
html{scroll-padding-top:52px;scrollbar-color:var(--neutral) transparent}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
body{margin:0;background:var(--ground);color:var(--ink);font:15px/1.45 "Schibsted Grotesk",system-ui,sans-serif}
::selection{background:var(--accent);color:var(--on-accent)}
a{color:inherit;text-underline-offset:3px;text-decoration-thickness:1px}
a:focus-visible,input:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.band{background:var(--accent);color:var(--on-accent);font-size:13px;font-weight:600;padding:6px var(--gutter)}
.top,main{padding-inline:var(--gutter)}
.top{padding-top:clamp(24px,3.5vw,44px)}
h1{font-size:clamp(38px,6vw,72px);line-height:.98;font-weight:900;letter-spacing:-.04em;margin:0;padding-bottom:12px;border-bottom:6px solid var(--ink);text-wrap:balance;overflow-wrap:anywhere}
.top p{margin:10px 0 0;color:var(--text-2)}
.toc{position:sticky;top:0;z-index:3;background:var(--ground);display:flex;flex-wrap:wrap;gap:4px 22px;margin-top:18px;
padding:9px var(--gutter);border-block:1px solid var(--rule);font-size:13.5px;font-weight:600}
.toc a{text-decoration:none}
.toc a:hover{text-decoration:underline}
section{margin-top:52px}
h2{font-size:clamp(26px,2.8vw,36px);line-height:1.08;font-weight:800;letter-spacing:-.03em;margin:0;padding-bottom:8px;border-bottom:4px solid var(--ink);text-wrap:balance}
.intro{max-width:75ch;margin:10px 0 0;color:var(--text-2);font-size:14.5px}
.figs{display:grid;grid-template-columns:repeat(4,1fr);gap:20px 28px;margin-top:20px}
.fig{border-top:2px solid var(--ink);padding-top:8px;display:flex;flex-direction:column;min-width:0}
.fig b{font-size:clamp(24px,2.4vw,34px);line-height:1.08;font-weight:800;letter-spacing:-.03em;overflow-wrap:anywhere}
.fig span{margin-top:4px;font-size:14px;font-weight:600;line-height:1.3}
.fig small{margin-top:1px}
small{color:var(--muted);font-size:12.5px;font-weight:400;letter-spacing:0}
.facts{margin:20px 0 0;padding-top:10px;border-top:1px solid var(--rule);color:var(--text-2);font-size:14px}
.mk{width:11px;height:11px;display:inline-block;vertical-align:-1px;flex:none}
table{border-collapse:collapse;width:100%;font-size:13.5px}
thead th{font-size:12.5px;font-weight:600;color:var(--text-2);text-align:left;vertical-align:bottom;padding:5px 10px 5px 0;border-bottom:2px solid var(--ink)}
tbody th,tbody td{text-align:left;font-weight:400;padding:5px 10px 5px 0}
.plain .n,.plain thead th.n{text-align:right;padding:5px 0 5px 8px;white-space:nowrap}
.plain tbody tr{border-bottom:1px solid var(--rule)}
.plain tbody tr:hover>*{background:var(--sunken)}
.blocks{columns:2;column-gap:44px;margin-top:6px}
.block{break-inside:avoid;padding-top:16px}
.blocks table{table-layout:fixed}
.blocks thead th:nth-child(1){width:29%}.blocks thead th:nth-child(2){width:28%}.blocks thead th:nth-child(3){width:8%}.blocks thead th:nth-child(4){width:11%}.blocks thead th:nth-child(5){width:15%}.blocks thead th:nth-child(6){width:9%}
h3{font-size:17px;line-height:1.25;font-weight:700;margin:0 0 4px}
.people{margin-top:12px}
.people tbody th{white-space:nowrap}
.people td.wide,.people thead th:nth-child(3){padding-left:24px}
.key{list-style:none;display:flex;flex-wrap:wrap;gap:4px 20px;padding:0;margin:24px 0 10px;font-size:13.5px;color:var(--text-2)}
.sw{display:inline-block;width:26px;height:10px;background:var(--slate);border-right:2px solid var(--ink);margin-right:2px;vertical-align:-1px}
.sw.open{background:repeating-linear-gradient(135deg,var(--slate) 0 2px,transparent 2px 5px);border:0}
.chart{--name:164px;--n:58px;--res:192px;font-size:13.5px}
.chart-head,.chart-foot{display:grid;grid-template-columns:var(--name) var(--n) 1fr var(--res)}
.chart-head{font-size:12.5px;font-weight:600;color:var(--text-2);border-bottom:2px solid var(--ink);padding-bottom:4px}
.chart-foot{font-size:12.5px;font-weight:600;color:var(--text-2);padding-top:3px}
.chart-foot .axis{grid-column:3}
.res-h{padding-left:14px}
.axis{position:relative;display:block;height:1.4em}
.axis span{position:absolute;padding-left:4px;white-space:nowrap}
.chart-foot .axis span{transform:translateX(-100%);padding:0 4px 0 0}
.chart-group{font-weight:700;font-size:14.5px;padding:14px 0 3px;border-bottom:1px solid var(--ink)}
.proj{display:grid;grid-template-columns:var(--name) minmax(0,1fr);border-bottom:1px solid var(--rule)}
.pname{padding:5px 8px 0 0;font-weight:600;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pname:hover{text-decoration:underline}
.att{display:grid;grid-template-columns:var(--n) minmax(0,1fr) var(--res);text-decoration:none}
.att:hover{background:var(--sunken)}
.att-n{align-self:center;color:var(--muted);font-size:13px}
.plot{position:relative;display:block;min-height:28px;background:var(--grid)}
.bar{position:absolute;top:50%;height:10px;margin-top:-5px;min-width:2px;background:var(--slate);border-right:2px solid var(--ink)}
.bar.open{background:repeating-linear-gradient(135deg,var(--slate) 0 2px,transparent 2px 5px);border:0}
.dot{position:absolute;top:50%;transform:translate(-50%,-50%);line-height:0;padding:3px}
.before{position:absolute;left:6px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:12.5px;white-space:nowrap}
.res{align-self:center;padding-left:14px;white-space:nowrap}
.terms{display:grid;grid-template-columns:repeat(3,1fr);gap:12px 28px;margin:18px 0 0}
.terms div{border-top:1px solid var(--rule);padding-top:6px}
.terms dt{font-weight:700;font-size:14px}
.terms dd{margin:1px 0 0;color:var(--text-2);font-size:13.5px;line-height:1.4}
.toggle{display:inline-flex;align-items:center;gap:8px;margin-top:16px;font-size:13.5px;font-weight:600;cursor:pointer}
.toggle input{appearance:none;width:16px;height:16px;margin:0;border:2px solid var(--ink);display:grid;place-content:center;cursor:pointer}
.toggle input:checked{background:var(--ink)}
.toggle input:checked::after{content:"";width:8px;height:4px;margin-top:-2px;border:solid var(--ground);border-width:0 0 2px 2px;transform:rotate(-45deg)}
.group-title{font-size:clamp(20px,2vw,26px);font-weight:800;letter-spacing:-.02em;line-height:1.15;margin:36px 0 0;padding-bottom:6px;border-bottom:4px solid var(--ink)}
.sheet{margin-top:28px}
.sheet header{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 14px;border-bottom:2px solid var(--ink);padding-bottom:6px}
h4{font-size:clamp(19px,1.8vw,23px);line-height:1.15;font-weight:800;letter-spacing:-.02em;margin:0}
.sheet header p{margin:0;color:var(--text-2);font-size:14px}
.sheet .final{margin-left:auto}
.final b{font-size:clamp(19px,1.8vw,23px);font-weight:800;letter-spacing:-.02em;color:var(--ink)}
article{margin-top:16px}
article+article{border-top:1px solid var(--rule);padding-top:16px}
h5{font-size:15px;line-height:1.3;font-weight:700;margin:0}
.who{margin:1px 0 0;color:var(--text-2);font-size:14px}
.steps{list-style:none;display:grid;grid-template-columns:repeat(5,1fr);gap:8px 20px;padding:0;margin:10px 0 12px}
.steps li{display:flex;flex-direction:column;line-height:1.3;min-width:0}
.steps b{font-size:14px;font-weight:600}
.steps small,.steps em{font-size:12.5px}
.steps em{font-style:normal;color:var(--muted)}
.empty{color:var(--muted);margin:0;font-size:14px}
.ledger{table-layout:fixed}
.ledger tbody th,.ledger tbody td{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ledger tbody td:nth-child(7){white-space:normal}
.c0{width:15%}.c1,.c2{width:9.5%}.c3{width:9.5%}.c4{width:6.5%}.c5{width:15.5%}.c6{width:13.5%}.c7{width:9.5%}.c8{width:11%}
.ev{border-bottom:1px solid var(--rule)}
.ev:hover>tr>*{background:var(--sunken)}
.meter{position:relative;display:inline-block;width:32px;height:8px;margin-right:6px;background:var(--sunken);vertical-align:0}
.ev:hover .meter{background:var(--rule)}
.meter i{position:absolute;inset:0 auto 0 0;background:var(--slate)}
.meter u{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;background:var(--ink)}
.seat.on{font-weight:600}
.seat.off{color:var(--text-2)}
.seat.none{color:var(--muted)}
.ledger .note td{white-space:normal;overflow:visible;padding:0 0 8px;color:var(--text-2);font-size:13px}
.note p{margin:0 0 2px;max-width:120ch}
.note b{font-weight:600;color:var(--ink)}
body:not(:has(#notes:checked)) .note{display:none}
.notes{padding-left:18px;margin:12px 0 56px;max-width:75ch;color:var(--text-2);font-size:14px}
.notes li{margin-bottom:4px}
@media screen and (max-width:1199px){.blocks{columns:1}}
@media screen and (max-width:1099px){
.ledger,.ledger tbody,.ledger tr,.ledger th,.ledger td{display:block}
.ledger thead,.ledger colgroup{display:none}
.ledger .ev>tr:first-child{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:6px 16px;padding:8px 0}
.ledger tbody th{grid-column:1/-1;font-weight:700;padding:0;white-space:normal}
.ledger tbody td{padding:0;white-space:normal;overflow:visible}
.ledger .ev td::before{content:attr(data-l);display:block;color:var(--muted);font-size:12.5px;font-weight:400}
.ledger .note td::before{content:none}
}
@media screen and (max-width:960px){.figs{grid-template-columns:repeat(2,1fr);gap:16px 20px}.terms{grid-template-columns:repeat(2,1fr)}.steps{grid-template-columns:repeat(3,1fr)}}
@media screen and (max-width:760px){
.chart-head,.chart-foot{grid-template-columns:1fr}
.chart-head>span:not(.axis){display:none}
.chart-foot .axis{grid-column:1}
.axis .minor{display:none}
.proj{display:block}
.pname{display:block;padding:7px 0 0}
.att{grid-template-columns:auto 1fr;grid-template-areas:"n res" "plot plot"}
.att-n{grid-area:n}
.res{grid-area:res;text-align:right;white-space:normal}
.plot{grid-area:plot;min-height:22px}
}
@media screen and (max-width:640px){
section{margin-top:40px}
.toc{position:static}
.terms{grid-template-columns:1fr}
.steps{grid-template-columns:repeat(2,1fr)}
.ledger .ev>tr:first-child{grid-template-columns:repeat(2,minmax(0,1fr))}
.plain,.plain tbody,.plain tr,.plain th,.plain td{display:block}
.plain thead{display:none}
.plain tbody tr{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:2px 10px;padding:6px 0}
.plain tbody th{grid-column:1/-1;font-weight:600;padding:0;white-space:normal}
.plain tbody td,.plain tbody td.n{padding:0;text-align:left;white-space:normal}
.plain td.wide{grid-column:1/-1}
.plain .n::before{content:attr(data-l);display:block;color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.people td.wide{color:var(--text-2);padding-left:0}
}
@media print{
@page{size:A4 landscape;margin:10mm}
:root{--ground:#fff}
*{print-color-adjust:exact;-webkit-print-color-adjust:exact}
body{font-size:11px}
.toc,.toggle{display:none}
.band{font-size:9px;padding:3px 0;background:none;border-bottom:1px solid var(--rule)}
.top,main{padding:0}
.top{padding-top:8px}
h1{font-size:34px;padding-bottom:6px;border-bottom-width:4px}
.top p{font-size:11px;margin-top:5px}
section{margin-top:18px}
#detalle,#intentos{break-before:page;margin-top:0}
h2{font-size:20px;padding-bottom:4px;border-bottom-width:3px;break-after:avoid}
.intro,.terms dd{font-size:11px}
.intro{max-width:none;margin-top:5px}
.figs{gap:10px 16px;margin-top:10px}
.fig{padding-top:4px}
.fig b{font-size:19px}
.fig span{font-size:11px;margin-top:2px}
small{font-size:10px}
#detalle .figs{grid-template-columns:repeat(8,1fr);gap:8px 12px}
#detalle .fig b{font-size:16px}
#detalle .fig span{font-size:10px;line-height:1.2}
#detalle .fig small{font-size:9px;line-height:1.2}
.facts{font-size:11px;margin-top:10px;padding-top:6px}
table{font-size:10px}
thead th{font-size:9.5px;padding:3px 8px 3px 0;line-height:1.2}
tbody th,tbody td,.plain .n,.plain thead th.n{padding-top:2px;padding-bottom:2px}
.block{padding-top:8px}
.blocks{column-gap:24px;margin-top:2px}
h3{font-size:12px;margin-bottom:2px}
.key{font-size:10px;margin:8px 0 4px;gap:3px 14px}
.chart{--name:112px;--n:38px;--res:128px;font-size:9.5px}
.chart-head,.chart-foot{font-size:9px}
.chart-group{font-size:10px;padding:5px 0 1px;break-after:avoid}
.pname{padding-top:2px}
.plot{min-height:15px}
.att-n{font-size:9px}
.res{padding-left:8px}
.res-h{padding-left:8px}
.bar{height:7px;margin-top:-3.5px}
.dot{padding:1px}
.dot .mk{width:8px;height:8px}
.terms{gap:6px 16px;margin-top:8px}
.terms dt{font-size:11px}
.group-title{font-size:15px;margin-top:14px;padding-bottom:3px;border-bottom-width:3px;break-after:avoid}
.sheet{margin-top:12px}
.sheet header{padding-bottom:3px;border-bottom-width:1px;break-after:avoid}
h4,.final b{font-size:14px}
.sheet header p{font-size:11px}
article{margin-top:7px;break-inside:avoid}
article+article{padding-top:7px}
h5{font-size:11px}
.who{font-size:10.5px;margin:0}
.steps{gap:3px 12px;margin:3px 0 5px}
.steps li{line-height:1.25}
.steps b{font-size:10.5px}
.steps small,.steps em{font-size:9.5px}
.ledger small{display:none}
.c0{width:11%}.c1,.c2{width:8.5%}.c3{width:9%}.c4{width:7%}.c5{width:16.5%}.c6{width:13%}.c7{width:10%}.c8{width:16%}
.meter{width:22px;height:6px;margin-right:4px}
.ledger .note td{font-size:9.5px;padding-bottom:4px}
.notes{margin:6px 0 0;font-size:11px}
}
"""


def extract(login, api, saved):
    """Replace the saved extraction with a new one; a failure leaves the old one as it was."""
    try:
        uid = api.get(f"/v2/users/{login}")["id"]
    except ApiError as err:
        sys.exit(f"No such login: {login}" if err.status == 404 else f"Could not look {login} up: {err}")
    tmp = saved.with_suffix(".tmp")
    try:
        done = subprocess.run(["go", "run", "./cmd/devtools", "fetch", str(uid), str(tmp)], cwd=REPO / "server")
    except FileNotFoundError:
        sys.exit("The extraction needs Go: see tools/evaluation-report/README.md")
    if done.returncode:
        tmp.unlink(missing_ok=True)
        sys.exit(f"The extraction of {login} failed (see above); nothing was saved")
    os.replace(tmp, saved)


def ask_login():
    try:
        login = input("42 login to extract: ").strip().lower()
    except EOFError:
        sys.exit("No login given")
    if not valid_login(login):
        sys.exit(f"Not a 42 login: {login!r}")
    return login


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--fresh", action="store_true", help="extract again even if the saved extraction is under an hour old")
    ap.add_argument("--report", type=Path, help="render this saved report: no prompt, no API; seats not looked up show Sin datos")
    ap.add_argument("--out", type=Path, help="page to write (default out/<login>.html)")
    args = ap.parse_args()

    api = None
    if args.report:
        saved = args.report
    else:
        login = ask_login()
        DATA.mkdir(mode=0o700, exist_ok=True)
        saved = DATA / f"{login}.json"
        api = Api()
        if args.fresh or not saved.exists() or time.time() - saved.stat().st_mtime > REUSE_SECONDS:
            extract(login, api, saved)
        else:
            print(f"Using the extraction saved {(time.time() - saved.stat().st_mtime) / 60:.0f} min ago (--fresh repeats it)")

    raw = json.loads(saved.read_text())
    doc = hide(raw, optouts(), raw["periods"]["all"]["profile"]["login"])
    if api and doc != raw:  # the saved extraction stops naming them too (only then: its date says when to extract again)
        saved.write_text(json.dumps(doc))
    rep = doc["periods"]["all"]
    teams = {a["team_id"] for p in selected(rep["projects"]) for a in p["attempts"]}
    evals = [e for e in rep["received"] if e["team_id"] in teams]
    seats_file = saved.with_name(f"{saved.stem}-seats.json")
    cache = json.loads(seats_file.read_text()) if api and seats_file.exists() else {}

    def lookup(e):
        begin, end = window(e)
        fmt = lambda ms: datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        login_of = urllib.parse.quote(e["corrector"]["login"])
        try:  # an erased account answers 404: its seat stays unknown
            return api.get_all(f"/v2/users/{login_of}/locations", **{"range[begin_at]": f"{fmt(begin - 86400000)},{fmt(end)}"})
        except ApiError as err:
            raise LookupFailed from err

    seats = corrector_seats(evals, cache, lookup if api else None)
    if api:
        seats_file.write_text(json.dumps(cache))
        seats_file.chmod(0o600)
    out = args.out or OUT / f"{rep['profile']['login']}.html"
    out.parent.mkdir(mode=0o700, exist_ok=True)
    out.write_text(render(doc, seats))
    out.chmod(0o600)
    print(f"{out}: {len(rep['projects'])} projects, {len(teams)} detailed attempts, {len(evals)} evaluations, "
          f"corrector seat known for {len(seats)}" + (f"; {api.calls} requests besides the extraction" if api else ""))
    print("It names other students: keep it private.")


if __name__ == "__main__":
    main()
