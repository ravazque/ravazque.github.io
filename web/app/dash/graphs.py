"""Seat plans, heatmaps, the calendar, the skills radar, the Connections bubbles and the circle ring."""
import math
from datetime import date

from markupsafe import Markup, escape

GROUPS = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06", "outer-core", "alumni", "no-cursus"]
ACCENT = ("var(--ramp-hi)", "var(--ramp-lo)")
SLATE = ("var(--slate)", "var(--slate-lo)")


def ramp(v, top) -> float:
    return math.sqrt(v / top) if top else 0


def mix(colors, v) -> str:
    return f"color-mix(in oklab, {colors[0]} {v * 100:.1f}%, {colors[1]})"


def scale(f, top, unit, colors=ACCENT) -> Markup:
    return Markup(f'<span class="grp"><i style="background:var(--seat-empty)"></i>{escape(f("scale.none"))}</span>'
                  f'<span class="grp">{escape(f("scale.less"))}' + "".join(f'<i style="background:{mix(colors, s)}"></i>' for s in (0, .25, .5, .75, 1))
                  + f'{escape(f("scale.more", max=f.num(top, 1), unit=unit))}</span>')


def roving(f, label: str) -> str:
    return f' data-roving role="group" aria-label="{escape(f("a11y.grid", label=label))}"'


def seat_plan(f, layout, values, *, unit, detail, to_unit=lambda v: v, anchor=False) -> tuple[Markup, Markup]:
    """(plan, scale) for {host: value}; detail(host, value) is the cell's label."""
    top = max(values.values(), default=0)
    top_host = next((h for h, v in values.items() if v == top), None) if top else None
    seen, out = set(), []
    for c, shape in layout.items():
        total, rows = 0, []
        for r in range(1, shape["rows"] + 1):
            cells = []
            for s in range(1, shape["seats"] + 1):
                host = f"{c}r{r}s{s}"
                v = values.get(host)
                if not v:
                    cells.append('<span class="seat"></span>')
                    continue
                total += v
                seen.add(host)
                label = detail(host, v) + (f' · {f("plan.most_used_short")}' if host == top_host else "")
                cells.append(f'<span class="seat on{" top" if host == top_host else ""}"{f" id=seat-{host}" if anchor else ""} data-cell'
                             f' role="img" style="--v:{ramp(v, top):.3f}" aria-label="{escape(label)}" data-tip="{escape(label)}" title="{escape(label)}"></span>')
            rows.append(f'<div class="row" style="--seats:{shape["seats"]}"><span class="rn" aria-hidden="true">r{r}</span>{"".join(cells)}</div>')
        out.append(f'<figure class="cluster"><figcaption><b>{c}</b><span>{f.num(to_unit(total), 1)} {escape(unit)}</span></figcaption>{"".join(rows)}</figure>')
    other = [(h, v) for h, v in values.items() if h not in seen]
    if other:
        out.append(f'<p class="note plan-other">{escape(f("plan.not_on_plan", list=", ".join(f"{h} ({f.num(to_unit(v), 1)} {unit})" for h, v in other)))}</p>')
    plan = Markup(f'<div class="plan"{roving(f, f("plan.label"))}>{"".join(out)}</div>')
    sc = scale(f, to_unit(top), unit) if top else Markup(f'<span>{escape(f("empty.period"))}</span>')
    if top_host:
        sc += Markup(f'<span class="grp"><i style="background:var(--seat-empty);box-shadow:inset 0 0 0 2px var(--ink)"></i>'
                     f'{escape(f("plan.most_used", seat=top_host))}</span>')
    return plan, Markup(f'<div class="scale">{sc}</div>')


def heat(f, grid, colors, unit) -> Markup:
    top = max((v for row in grid for v in row), default=0)
    cells = ['<span></span>'] + [f'<span class="h" aria-hidden="true">{"" if h % 3 else h}</span>' for h in range(24)]
    for w, row in enumerate(grid):
        cells.append(f"<span>{f.weekdays[w]}</span>")
        for h, v in enumerate(row):
            if not v:
                cells.append('<span class="c"></span>')
                continue
            label = f"{f.weekdays[w]} {h:02d}:00 · {f.num(v, 1)} {unit}"
            cells.append(f'<span class="c" data-cell role="img" aria-label="{escape(label)}" data-tip="{escape(label)}" title="{escape(label)}"'
                         f' style="background:{mix(colors, ramp(v, top))}"></span>')
    sc = scale(f, top, unit, colors) if top else escape(f("empty.period"))
    return Markup(f'<div class="heat"{roving(f, f("heat.label"))}>{"".join(cells)}</div><div class="scale">{sc}</div>')


def calendar(f, days, hours) -> tuple[Markup, Markup]:
    top = max(hours, default=0)
    years = {}
    for d, h in zip(days, hours):
        years.setdefault(d[:4], []).append((d, h))
    crop = len(years) == 1
    out = []
    for y, items in years.items():
        jan1 = date(int(y), 1, 1)
        offset = jan1.weekday()
        n_of = lambda iso: (date.fromisoformat(iso) - jan1).days + offset  # noqa: E731
        skip = n_of(items[0][0]) // 7 if crop else 0
        pos = lambda iso: (max(1, n_of(iso) // 7 + 1 - skip), n_of(iso) % 7 + 2)  # noqa: E731
        months = "".join(f'<span class="m" style="grid-area:1/{pos(f"{y}-{m:02d}-01")[0]}/2/span 4">{f.months[m - 1]}</span>'
                         for m in range(1, 13) if any(d[:7] == f"{y}-{m:02d}" for d, _ in items))
        cells = []
        for d, v in items:
            c, r = pos(d)
            label = f'{f.day(d, weekday=True)} · {f"{f.num(v, 1)} h" if v else f("calendar.not_logged")}'
            cells.append(f'<span class="d on" data-cell role="img" style="grid-area:{r}/{c};--v:{ramp(v, top):.3f}" aria-label="{escape(label)}" data-tip="{escape(label)}" title="{escape(label)}"></span>'
                         if v else f'<span class="d" style="grid-area:{r}/{c}" data-tip="{escape(label)}" title="{escape(label)}"></span>')
        cols = n_of(items[-1][0]) // 7 - skip + 1
        out.append(f'<div class="cal-year"><b>{y}</b><div class="cal-grid{" crop" if crop else ""}" style="--cols:{max(cols, 5)}">{months}{"".join(cells)}</div></div>')
    body = "".join(out) or f'<p class="note">{escape(f("empty.sessions"))}</p>'
    return (Markup(f'<div id="calendar"{roving(f, f("calendar.label"))}>{body}</div>'),
            Markup(f'<div class="scale">{scale(f, top, f("unit.h_per_day")) if top else ""}</div>'))


def _radar_svg(f, items, label, compact) -> str:
    W, H = (400, 380) if compact else (560, 440)
    cx, cy, r, n = W / 2, H / 2, 150, len(items)
    top = max(5, math.ceil(max([0] + [s["level"] for s in items]) / 5) * 5)
    ang = lambda i: -math.pi / 2 + 2 * math.pi * (i + .5) / n  # noqa: E731
    pt = lambda i, v: (cx + max(0, min(1, (v or 0) / top)) * r * math.cos(ang(i)), cy + max(0, min(1, (v or 0) / top)) * r * math.sin(ang(i)))  # noqa: E731
    lh, gap, wrap = 15, 4, 15
    placed = []
    for i, s in enumerate(items):
        a, d = ang(i), r + (16 if compact else 22)
        x, y = cx + d * math.cos(a), cy + d * math.sin(a)
        anchor = "start" if math.cos(a) > .08 else "end" if math.cos(a) < -.08 else "middle"
        if compact:
            ls = [str(i + 1)]
        else:
            ls = [""]
            for w in s["name"].split(" "):
                if ls[-1] and len(f"{ls[-1]} {w}") > wrap:
                    ls.append(w)
                else:
                    ls[-1] = f"{ls[-1]} {w}".strip()
        h = len(ls) * lh
        top_y = y - h if math.sin(a) < -.5 and anchor == "middle" else y + 4 if math.sin(a) > .5 and anchor == "middle" else y - h / 2
        placed.append({"x": x, "top": top_y, "h": h, "anchor": anchor, "ls": ls})
    if not compact:
        for side in ("start", "end"):
            col = sorted((p for p in placed if p["anchor"] == side), key=lambda p: p["top"])
            for k in range(1, len(col)):
                col[k]["top"] = max(col[k]["top"], col[k - 1]["top"] + col[k - 1]["h"] + gap)
    rings = "".join(f'<circle class="ring" cx="{cx}" cy="{cy}" r="{r * k / 4}"/>' for k in (1, 2, 3, 4))
    spokes = "".join(f'<line class="spoke" x1="{cx}" y1="{cy}" x2="{pt(i, top)[0]:.1f}" y2="{pt(i, top)[1]:.1f}"/>' for i in range(n))
    shape = " ".join(f"{pt(i, s['level'])[0]:.1f},{pt(i, s['level'])[1]:.1f}" for i, s in enumerate(items))
    dots = "".join(f'<circle class="dot" cx="{pt(i, s["level"])[0]:.1f}" cy="{pt(i, s["level"])[1]:.1f}" r="3.5" data-tip="{escape(s["name"])} · {f.num(s["level"], 2)}"><title>{escape(s["name"])} · {f.num(s["level"], 2)}</title></circle>'
                   for i, s in enumerate(items) if s["level"])
    labels = "".join(f'<text class="label{" num" if compact else ""}" x="{p["x"]:.1f}" y="{p["top"] + lh - 3:.1f}" text-anchor="{p["anchor"]}">'
                     + "".join(f'<tspan x="{p["x"]:.1f}" dy="{lh if k else 0}">{escape(line)}</tspan>' for k, line in enumerate(p["ls"])) + "</text>"
                     for p in placed)
    aria = f"{label}: " + ", ".join(f"{s['name']} {f.num(s['level'], 2)}" for s in items)
    return (f'<svg class="radar{" compact" if compact else ""}" viewBox="0 0 {W} {H}" role="img" aria-label="{escape(aria)}">'
            f'{rings}{spokes}<polygon class="shape" points="{shape}"/>{dots}{labels}</svg>')


def radar(f, items, label) -> Markup:
    """The wide radar with names, and the compact one with numbers and a key; CSS shows the one that fits."""
    key = "".join(f'<li><span class="k">{i + 1}</span><span class="n">{escape(s["name"])}</span><span class="v">{f.num(s["level"], 2)}</span></li>'
                  for i, s in enumerate(items))
    return Markup(f'<div class="radar-wide">{_radar_svg(f, items, label, False)}</div>'
                  f'<div class="radar-narrow">{_radar_svg(f, items, label, True)}<ol class="radar-key">{key}</ol></div>')


LABEL_BAND = 28


def _cells(groups, width, height, sizes):
    present = [g for g in GROUPS if g in groups]
    cols = 2 if width < 600 else math.ceil(len(present) / 2) if len(present) > 5 else len(present)
    rows = max(1, math.ceil(len(present) / cols))
    out, top = {}, 0
    for row in range(rows):
        members = present[row * cols:(row + 1) * cols]
        raw = [math.sqrt(sizes.get(g, 1)) for g in members]
        weights = [max(w, .35 * max(raw)) for w in raw]
        widths = [width * w / sum(weights) for w in weights]
        need = max(math.pi * sizes.get(g, 1) / .6 / widths[i] + LABEL_BAND for i, g in enumerate(members))
        bottom = top + max(height / rows, need)
        left = 0
        for i, g in enumerate(members):
            out[g] = {"x": left + widths[i] / 2, "y": (top + LABEL_BAND + bottom) / 2, "top": top, "bottom": bottom, "left": left, "right": left + widths[i]}
            left += widths[i]
        top = bottom
    return out


def _pack(nodes, cell):
    """Biggest first, each on the nearest free spot of a spiral around the cell centre, inside the cell."""
    placed = []
    for n in sorted(nodes, key=lambda n: -n["r"]):
        for k in range(4000):
            a, d = k * .5, 2.2 * math.sqrt(k) * 3
            x = min(max(cell["x"] + d * math.cos(a), cell["left"] + n["r"]), cell["right"] - n["r"])
            y = min(max(cell["y"] + d * math.sin(a), cell["top"] + LABEL_BAND + n["r"]), cell["bottom"] - n["r"] - 6)
            if all((x - p["x"]) ** 2 + (y - p["y"]) ** 2 >= (n["r"] + p["r"] + 2) ** 2 for p in placed):
                break
        n["x"], n["y"] = x, y
        placed.append(n)


def bubbles(f, people, mode, *, width, height, href) -> str:
    """Connections: one bubble per person (two in "mix", joined by a line), sized by evaluations, grouped by rank."""
    nodes = []
    for p in people:
        for d in (("received", "given") if mode == "mix" else (mode,)):
            if p.get(d):
                nodes.append({"login": p["login"], "name": p.get("name"), "group": p["group"], "dir": d, "count": p[d],
                              "r": 6 + 5 * math.sqrt(p[d]), "p": p})
    if not nodes:
        return ""
    sizes = {}
    for n in nodes:
        sizes[n["group"]] = sizes.get(n["group"], 0) + (n["r"] + 2) ** 2
    cells = _cells(list(sizes), width, height, sizes)
    for g, cell in cells.items():
        _pack([n for n in nodes if n["group"] == g], cell)
    h = max([height] + [math.ceil(c["bottom"]) for c in cells.values()])
    at = {(n["login"], n["dir"]): n for n in nodes}
    links = "".join(f'<line class="link" x1="{n["x"]:.1f}" y1="{n["y"]:.1f}" x2="{at[(n["login"], "given")]["x"]:.1f}" y2="{at[(n["login"], "given")]["y"]:.1f}"/>'
                    for n in nodes if mode == "mix" and n["dir"] == "received" and (n["login"], "given") in at)
    labels = "".join(f'<text class="group-label" text-anchor="middle" x="{c["x"]:.1f}" y="{c["top"] + 18:.1f}">'
                     f'{escape(f(f"groups.{g}"))} · {sum(1 for n in nodes if n["group"] == g)}</text>' for g, c in cells.items())
    marks = []
    for n in nodes:
        p = n["p"]
        parts = [p["login"], p.get("name"), f("connections.tip_counts", received=p.get("received", 0), given=p.get("given", 0)),
                 f("groups." + p["group"]), f("connections.tip_last", when=p["last"]) if p.get("last") else None]
        tip = " · ".join(x for x in parts if x)
        initials = "".join(w[0] for w in str(p.get("name") or p["login"]).replace(".", " ").replace("_", " ").replace("-", " ").split() if w)[:2].upper()
        marks.append(f'<a href="{escape(href(p["login"]))}" class="bubble {n["dir"]}" data-cell aria-label="{escape(tip)}" data-tip="{escape(tip)}"'
                     f' transform="translate({n["x"]:.1f},{n["y"]:.1f})" style="--lvl:{level(n["group"]):.2f}"><title>{escape(tip)}</title>'
                     f'<circle class="halo" r="{n["r"] + 5:.1f}"/><circle class="core" r="{n["r"]:.1f}"/>'
                     + (f'<text text-anchor="middle" dy="0.35em">{escape(initials)}</text>' if n["r"] >= 15 else "") + "</a>")
    return (f'<svg class="graph" viewBox="0 0 {width} {h}" style="aspect-ratio:{width}/{h}"{roving(f, f("connections.title"))}>'
            f'<g class="labels">{labels}</g><g class="links">{links}</g><g class="nodes">{"".join(marks)}</g></svg>')


def level(group) -> float:
    """0 (no 42cursus, Rank 00) … 1 (Alumni): how far along the 42cursus someone is, for the halo."""
    order = ["no-cursus", "rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06", "outer-core", "alumni"]
    return order.index(group) / (len(order) - 1) if group in order else 0


def _net_class(g):
    return "me" if g == "me" else "outer" if g == "outer-core" else "alumni" if g == "alumni" else "rank" if (g or "").startswith("rank-") else "none"


def _trim(x1, y1, cx, cy, by):
    """A point `by` units from (x1, y1) towards the curve's control point: where an arrowhead meets a node's edge."""
    dx, dy = cx - x1, cy - y1
    d = math.hypot(dx, dy) or 1
    return x1 + dx * by / d, y1 + dy * by / d


def ring(f, net, *, width, height, compact, uid="c") -> str:
    """Your circle: you in the centre, contacts on a ring ordered by group. An arrow goes from the corrector to the one
    evaluated; a chord with arrows at both ends means they evaluated each other."""
    pairs = {}
    for l in net.get("links") or []:
        a, b = sorted((l["source"], l["target"]))
        p = pairs.setdefault((a, b), {"ab": 0, "ba": 0})
        p["ab" if l["source"] == a else "ba"] += l["count"]
    degree = {}
    for (a, b), p in pairs.items():
        degree[a] = degree.get(a, 0) + p["ab"] + p["ba"]
        degree[b] = degree.get(b, 0) + p["ab"] + p["ba"]
    k = .6 if compact else 1
    radius = lambda n: (16 if n["group"] == "me" else 6 + min(10, math.sqrt(degree.get(n["login"], 0)) * 1.4)) * k  # noqa: E731
    me = [n for n in net.get("nodes") or [] if n["group"] == "me"]
    others = sorted((n for n in net.get("nodes") or [] if n["group"] != "me"),
                    key=lambda n: (GROUPS.index(n["group"]) if n["group"] in GROUPS else 99, -degree.get(n["login"], 0)))
    cx, cy = width / 2, height / 2
    R = max(80, min(width, height) / 2 - (22 if compact else 70))
    at = {n["login"]: {**n, "x": cx, "y": cy, "a": 0, "r": radius(n)} for n in me}
    for i, n in enumerate(others):
        a = -math.pi / 2 + 2 * math.pi * i / len(others)
        at[n["login"]] = {**n, "a": a, "x": cx + R * math.cos(a), "y": cy + R * math.sin(a), "r": radius(n)}
    marker = f"arr-{uid}"
    chords, arrows = [], []
    for (a, b), c in pairs.items():
        if a not in at or b not in at:
            continue
        p, q = at[a], at[b]
        mx, my = (p["x"] + q["x"]) / 4 + cx / 2, (p["y"] + q["y"]) / 4 + cy / 2
        x1, y1 = _trim(p["x"], p["y"], mx, my, p["r"] + 2)
        x2, y2 = _trim(q["x"], q["y"], mx, my, q["r"] + 2)
        both = c["ab"] and c["ba"]
        # the path runs a → b: marker-end points at b (a evaluated b), marker-start back at a (b evaluated a)
        ends = (f' marker-end="url(#{marker})"' if c["ab"] else "") + (f' marker-start="url(#{marker})"' if c["ba"] else "")
        tip = " · ".join(x for x in [f"{a} → {b} ×{c['ab']}" if c["ab"] else "", f"{b} → {a} ×{c['ba']}" if c["ba"] else ""] if x)
        d = f"M{x1:.1f},{y1:.1f} Q{mx:.1f},{my:.1f} {x2:.1f},{y2:.1f}"
        chords.append(f'<path class="{"both" if both else "one"}" data-a="{escape(a)}" data-b="{escape(b)}" data-tip="{escape(tip)}"'
                      f' stroke-width="{min(5, 1 + (c["ab"] + c["ba"]) / 3):.1f}" d="{d}"><title>{escape(tip)}</title></path>')
        # the arrowheads live on a twin path, shown only for the person in focus
        arrows.append(f'<path data-a="{escape(a)}" data-b="{escape(b)}"{ends} d="{d}"/>')
    marks = []
    for n in at.values():
        d = degree.get(n["login"], 0)
        tip = n["login"] if n["group"] == "me" else " · ".join([n["login"], f("groups." + n["group"]), f("network.tip", count=d, n=d)])
        text = ""
        if n["group"] == "me":
            text = f'<text y="{n["r"] + 18:.1f}" text-anchor="middle">{escape(n["login"])}</text>'
        elif not compact:
            anchor = "start" if math.cos(n["a"]) > .15 else "end" if math.cos(n["a"]) < -.15 else "middle"
            text = (f'<text x="{(n["r"] + 6) * math.cos(n["a"]):.1f}" y="{(n["r"] + 6) * math.sin(n["a"]) + 4:.1f}"'
                    f' text-anchor="{anchor}">{escape(n["login"])}</text>')
        marks.append(f'<g class="net-node {_net_class(n["group"])}" data-login="{escape(n["login"])}" data-cell role="img"'
                     f' aria-label="{escape(tip)}" data-tip="{escape(tip)}" transform="translate({n["x"]:.1f},{n["y"]:.1f})"'
                     f' style="--lvl:{level(n["group"]):.2f}"><title>{escape(tip)}</title><circle class="halo" r="{n["r"] + (4 if compact else 6):.1f}"/>'
                     f'<circle class="core" r="{n["r"]:.1f}"/>{text}</g>')
    defs = (f'<defs><marker id="{marker}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse"'
            f' markerWidth="{5 if compact else 6}" markerHeight="{5 if compact else 6}" orient="auto-start-reverse">'
            f'<path d="M0,1 L10,5 L0,9 Z" class="arrowhead"/></marker></defs>')
    return (f'<svg class="graph net" viewBox="0 0 {width} {height}"{roving(f, f("network.title"))}>{defs}'
            f'<g class="net-links">{"".join(chords)}</g><g class="net-arrows">{"".join(arrows)}</g>'
            f'<g class="net-nodes">{"".join(marks)}</g></svg>')
