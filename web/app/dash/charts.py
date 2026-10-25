"""Charts rendered on the server: HTML/CSS bars and timelines, SVG lines. Colours are CSS variables, sizes come from
ui.json through dash.css; every mark carries a data-tip and every chart an aria-label summary."""
import math

from markupsafe import Markup, escape

S1, S2 = "var(--accent-data)", "var(--slate)"
GOOD, BAD, NEUTRAL = "var(--good)", "var(--critical)", "var(--neutral)"


def _pct(v, top) -> str:
    return f"{100 * v / top:.2f}%" if top else "0%"


def nice_max(v: float) -> float:
    """The next round value at or above v for an axis: 1, 2, 2.5, 5 × 10ⁿ."""
    if v <= 0:
        return 1
    mag = 10 ** math.floor(math.log10(v))
    return next(m * mag for m in (1, 2, 2.5, 5, 10) if m * mag >= v)


def legend(items) -> Markup:
    """items: [(label, colour)]."""
    return Markup('<div class="legend">' + "".join(
        f'<span><i style="background:{c}"></i>{escape(label)}</span>' for label, c in items) + "</div>")


def empty(text: str) -> Markup:
    return Markup(f'<p class="note chart-empty">{escape(text)}</p>')


def _tick(f, v, d) -> str:
    """An axis tick: thousands as "k" from 10,000 up, so six-digit scales fit a phone's axis."""
    return f"{f.num(v / 1000, 1)}k" if abs(v) >= 10000 else f.num(v, d)


def _yaxis(f, top) -> str:
    d = 0 if (top / 4) % 1 == 0 else 1 if (top / 4 * 10) % 1 == 0 else 2  # quarter ticks keep their decimals
    return '<div class="ch-y" aria-hidden="true">' + "".join(
        f'<span style="bottom:{_pct(top * k / 4, top)}">{escape(_tick(f, top * k / 4, d))}</span>' for k in range(5)) + "</div>"


def vbars(f, labels, series, *, label, stacked=False, xtitle=None, peak=None, line=None, fmt=None, every=None, tips=None,
          empty_text="") -> Markup:
    """Vertical bars per label. series: [(name, values, colour)], side by side or stacked.
    peak: a format string for the tallest column's caption ({v}, {label}). line: (name, values, colour) drawn over the
    bars on its own right-hand scale (cumulative figures). tips: one text per label instead of the series' values."""
    if not labels or not any(v for _, vals, _ in series for v in vals):
        return empty(empty_text)
    fmt = fmt or (lambda v: f.num(v, 1))
    totals = [sum(vals[i] or 0 for _, vals, _ in series) if stacked else max(vals[i] or 0 for _, vals, _ in series)
              for i in range(len(labels))]
    top = nice_max(max(totals))
    every = every or max(1, math.ceil(len(labels) / 12))
    best = totals.index(max(totals))
    cols = []
    for i, lab in enumerate(labels):
        tip = tips[i] if tips else " · ".join([lab] + [f"{name} {fmt(vals[i] or 0)}" for name, vals, _ in series]
                                              + ([f"{line[0]} {fmt(line[1][i])}"] if line else []))
        # the details belong to the bars, not to the column's empty space above them
        bars = "".join(f'<i style="height:{_pct(vals[i] or 0, top)};background:{c}"' + (f' data-tip="{escape(tip)}" title="{escape(tip)}"' if vals[i] else "") + "></i>"
                       for _, vals, c in series)
        cap = (f'<b class="peak">{escape(peak.format(v=fmt(totals[i]), label=lab))}</b>' if peak and i == best else "")
        cols.append(f'<div class="ch-col{" stack" if stacked else ""}">{cap}{bars}</div>')
    overlay = ""
    if line:
        ltop = nice_max(max(line[1]) or 1)
        pts = " ".join(f"{(i + .5) * 1000 / len(labels):.1f},{300 - 300 * v / ltop:.1f}" for i, v in enumerate(line[1]))
        overlay = (f'<svg class="ch-line" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">'
                   f'<polyline points="{pts}" pathLength="1" style="stroke:{line[2]}"/></svg>'
                   + '<div class="ch-y right" aria-hidden="true">' + "".join(
                       f'<span style="bottom:{_pct(ltop * k / 4, ltop)}">{escape(_tick(f, ltop * k / 4, 2))}</span>' for k in range(5)) + "</div>"
                   # without the right axis (narrow charts) the line still says where it ends
                   + f'<b class="line-end" style="bottom:{_pct(line[1][-1] or 0, ltop)}">{escape(line[0])} {escape(fmt(line[1][-1] or 0))}</b>')
    # every second shown label is marked so narrow charts can drop it
    xs = "".join(f'<span{" class=\"alt\"" if (i // every) % 2 else ""}>{escape(lab)}</span>' if i % every == 0 else "<span></span>"
                 for i, lab in enumerate(labels))
    summary = f"{label}: " + ", ".join(f"{lab} {fmt(totals[i])}" for i, lab in enumerate(labels) if totals[i])
    return Markup(
        f'<figure class="vchart{" has-line" if line else ""}" role="img" aria-label="{escape(summary)}">'
        f'<div class="ch-plot">{_yaxis(f, top)}<div class="ch-cols" style="--n:{len(labels)}">{"".join(cols)}</div>{overlay}</div>'
        f'<div class="ch-x" style="--n:{len(labels)}" aria-hidden="true">{xs}</div>'
        + (f'<figcaption class="ch-title">{escape(xtitle)}</figcaption>' if xtitle else "") + "</figure>")


def hbars(f, labels, series, *, label, end=None, extra=None, tips=None, empty_text="") -> Markup:
    """Horizontal stacked bars, one row per label, the total at the bar's end. series: [(name, values, colour)].
    extra(i) adds a secondary note after the total, dropped on narrow panels (the tooltip keeps it)."""
    if not labels:
        return empty(empty_text)
    totals = [sum(vals[i] or 0 for _, vals, _ in series) for i in range(len(labels))]
    top = (max(totals) or 1) * 1.3  # the longest bar leaves room for its end label
    end = end or (lambda i, v: f.num(v, 2 if isinstance(v, float) and v % 1 else 0))
    rows = []
    for i, lab in enumerate(labels):
        tip = tips[i] if tips else " · ".join([lab] + [f"{name} {f.num(vals[i] or 0, 2)}" for name, vals, _ in series if vals[i]])
        segs = "".join(f'<i style="width:{_pct(vals[i] or 0, top)};background:{c}" data-tip="{escape(tip)}" title="{escape(tip)}"></i>' for _, vals, c in series if vals[i])
        rows.append(f'<div class="hb-row"><span class="hb-label">{escape(lab)}</span>'
                    f'<span class="hb-track">{segs}<b>{escape(end(i, totals[i]))}'
                    f'{f"<span class=hb-extra> · {escape(x)}</span>" if extra and (x := extra(i)) else ""}</b></span></div>')
    summary = f"{label}: " + ", ".join(f"{lab} {end(i, totals[i])}" for i, lab in enumerate(labels))
    return Markup(f'<figure class="hchart" role="img" aria-label="{escape(summary)}">{"".join(rows)}</figure>')


def lines(f, series, *, label, step=True, empty_text="") -> Markup:
    """Time series as SVG lines over an HTML axis. series: [(name, [{"x": ms, "y": v}], colour)]."""
    pts = [p for _, ps, _ in series for p in ps]
    if not pts:
        return empty(empty_text)
    lo, hi = min(p["x"] for p in pts), max(p["x"] for p in pts)
    pad = max((hi - lo) * 0.02, 864e5)
    lo, hi = lo - pad, hi + pad
    top = nice_max(max(p["y"] for p in pts))
    X = lambda x: 1000 * (x - lo) / (hi - lo)  # noqa: E731
    Y = lambda y: 300 - 300 * y / top  # noqa: E731
    paths = []
    for name, ps, c in series:
        if not ps:
            continue
        d, prev = [], None
        for p in sorted(ps, key=lambda p: p["x"]):
            if prev is not None and step:
                d.append(f"L{X(p['x']):.1f},{Y(prev):.1f}")
            d.append(f"{'L' if d else 'M'}{X(p['x']):.1f},{Y(p['y']):.1f}")
            prev = p["y"]
        d.append(f"L{X(hi):.1f},{Y(prev):.1f}")
        paths.append(f'<path d="{" ".join(d)}" pathLength="1" style="stroke:{c}"/>')
    # hover slices: the value of every series at the end of each slice
    n = 40
    slices = []
    for k in range(n):
        at = lo + (hi - lo) * (k + 1) / n
        vals = []
        for name, ps, _ in series:
            before = [p["y"] for p in ps if p["x"] <= at]
            vals.append(f"{name} {f.num(before[-1] if before else 0, 1)}")
        slices.append(f'<i data-tip="{escape(f.stamp(at).split(",")[0] + " · " + " · ".join(vals))}" title="{escape(f.stamp(at).split(",")[0] + " · " + " · ".join(vals))}"></i>')
    months = []
    span = hi - lo
    step_ms = max(1, round(span / 864e5 / 30 / 8)) * 30 * 864e5
    t = lo + step_ms / 2
    while t < hi:
        months.append(f'<span style="left:{100 * (t - lo) / span:.2f}%">{escape(f.month_of(t))}</span>')
        t += step_ms
    last = ", ".join(f"{name} {f.num(ps[-1]['y'], 1)}" for name, ps, _ in series if ps)
    return Markup(
        f'<figure class="lchart" role="img" aria-label="{escape(f"{label}: {last}")}">'
        f'<div class="ch-plot">{_yaxis(f, top)}<svg class="ch-lines" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">'
        f'{"".join(paths)}</svg><div class="ch-hover" style="--n:{n}">{"".join(slices)}</div></div>'
        f'<div class="ch-months" aria-hidden="true">{"".join(months)}</div></figure>')


def timeline(f, rows, *, label, empty_text="") -> Markup:
    """Gantt rows: [(row label, [(start_ms, end_ms, colour, tip)])] on one shared time axis."""
    spans = [s for _, ss in rows for s in ss]
    if not spans:
        return empty(empty_text)
    pad = 7 * 864e5
    lo, hi = min(s[0] for s in spans) - pad, max(max(s[0], s[1]) for s in spans) + pad
    span = hi - lo
    body = []
    for name, ss in rows:
        bars = "".join(f'<i style="left:{100 * (a - lo) / span:.2f}%;width:max(4px,{100 * (max(a, b) - a) / span:.2f}%);'
                       f'background:{c}" data-tip="{escape(tip)}" title="{escape(tip)}"></i>' for a, b, c, tip in ss)
        body.append(f'<div class="tl-row"><span class="tl-label" title="{escape(name)}">{escape(name)}</span><span class="tl-track">{bars}</span></div>')
    months, step_ms = [], max(1, round(span / 864e5 / 30 / 8)) * 30 * 864e5
    t = lo + step_ms / 2
    while t < hi:
        months.append(f'<span style="left:{100 * (t - lo) / span:.2f}%">{escape(f.month_of(t))}</span>')
        t += step_ms
    return Markup(f'<figure class="timeline" role="img" aria-label="{escape(label)}">{"".join(body)}'
                  f'<div class="tl-axis" aria-hidden="true"><span></span><span class="ch-months">{"".join(months)}</span></div></figure>')


def trend(values, *, bars=False, last=False) -> Markup:
    """A module's recent history under its figure: a hairline or thin columns, the newest one in the accent when last.
    Decorative next to the figure it follows (aria-hidden); empty when there is nothing to draw."""
    vals = [v or 0 for v in values][-24:]
    if len(vals) < 2 or not any(vals):
        return Markup("")
    top, n = max(vals) or 1, len(vals)
    if bars:
        w = 100 / n
        marks = "".join(f'<rect x="{i * w + w * .18:.2f}" y="{40 - 38 * v / top:.2f}" width="{w * .64:.2f}" height="{38 * v / top:.2f}"'
                        f'{" class=\"now\"" if last and i == n - 1 else ""}/>' for i, v in enumerate(vals))
        marks += '<line class="base" x1="0" y1="40" x2="100" y2="40"/>'  # the bars stand on a line, not in the air
    else:
        pts = " ".join(f"{100 * i / (n - 1):.2f},{40 - 38 * v / top:.2f}" for i, v in enumerate(vals))
        marks = f'<polyline points="{pts}" pathLength="1"/>'
    return Markup(f'<svg class="trend{" bars" if bars else ""}" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">{marks}</svg>')
