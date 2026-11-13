// Charts as markup: HTML/CSS bars and timelines, SVG lines. Colours are CSS variables, sizes come from ui.json; every
// mark carries a data-tip and every chart an aria-label summary.
import type { Fmt } from "../fmt";
import { esc, pct, tipAttr } from "./h";

export const S1 = "var(--accent-data)", S2 = "var(--slate)";
export const GOOD = "var(--good)", BAD = "var(--critical)", NEUTRAL = "var(--neutral)";

export type Series = [name: string, values: (number | null)[], colour: string];
export type Point = { x: number; y: number };

/** The next round value at or above v for an axis: 1, 2, 2.5, 5 × 10ⁿ. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}

/** A scale that ends at the first tick over the value, a quarter of the round number at a time (28k: up to 37.5k, not 50k). */
export function tightAxis(v: number): { top: number; steps: number } {
  const step = niceMax(v) / 4, steps = v > 0 ? Math.ceil(v / step) : 4;
  return { top: step * steps, steps };
}

export const legend = (items: [string, string][]) =>
  `<div class="legend">${items.map(([l, c]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join("")}</div>`;

export const empty = (text: string) => `<p class="note chart-empty">${esc(text)}</p>`;

/** An axis tick: thousands as "k" from 10,000 up, so six-digit scales fit a phone's axis. */
const tick = (f: Fmt, v: number, d: number) => (Math.abs(v) >= 10000 ? `${f.num(v / 1000, 1)}k` : f.num(v, d));

function yaxis(f: Fmt, top: number, steps = 4) {
  const q = top / steps;
  const d = q % 1 === 0 ? 0 : (q * 10) % 1 === 0 ? 1 : 2; // quarter ticks keep their decimals
  return `<div class="ch-y" aria-hidden="true">${Array.from({ length: steps + 1 }, (_, k) => `<span style="bottom:${pct(q * k, top)}">${esc(tick(f, q * k, d))}</span>`).join("")}</div>`;
}

type VOpts = {
  label: string; stacked?: boolean; tight?: boolean; xtitle?: string; peak?: string; line?: [string, number[], string]; barTips?: boolean;
  colTips?: boolean; // the whole column's strip opens the tip (a stacked month told whole), the others dim
  fmt?: (v: number) => string; every?: number; tips?: string[]; emptyText?: string;
};

/** Vertical bars per label, side by side or stacked; line draws over the bars on its own right-hand scale. */
export function vbars(f: Fmt, labels: string[], series: Series[], o: VOpts): string {
  if (!labels.length || !series.some(([, vals]) => vals.some((v) => v))) return empty(o.emptyText || "");
  const fmt = o.fmt || ((v: number) => f.num(v, 1));
  const totals = labels.map((_, i) =>
    o.stacked ? series.reduce((s, [, v]) => s + (v[i] || 0), 0) : Math.max(...series.map(([, v]) => v[i] || 0)));
  const { top, steps } = o.tight ? tightAxis(Math.max(...totals)) : { top: niceMax(Math.max(...totals)), steps: 4 };
  const every = o.every || Math.max(1, Math.ceil(labels.length / 12));
  const best = totals.indexOf(Math.max(...totals));
  const colTip = (series.length === 1 && !o.stacked && !o.barTips) || !!o.colTips; // one series: the whole column opens the tip
  const line = o.line;
  const cols = labels.map((lab, i) => {
    const tip = o.tips ? o.tips[i]
      : [lab, ...series.map(([n, v]) => `${n} ${fmt(v[i] || 0)}`), ...(line ? [`${line[0]} ${fmt(line[1][i])}`] : [])].join(" · ");
    let k = 0; // a stack grows from the bottom up, each part in its turn (--k: its place among the parts it has)
    const bars = series.map(([, v, c]) =>
      `<i style="height:${pct(v[i] || 0, top)};background:${c}${o.stacked && v[i] ? `;--k:${k++}` : ""}"${v[i] && !colTip ? tipAttr(tip) : ""}></i>`).join("");
    const cap = o.peak && i === best
      ? `<b class="peak">${esc(o.peak.replace("{v}", fmt(totals[i])).replace("{label}", lab))}</b>` : "";
    return `<div class="ch-col${o.stacked ? " stack" : ""}"${colTip ? tipAttr(tip) : ""}>${cap}${bars}</div>`;
  });
  let overlay = "";
  if (line) {
    // the line's scale ends just above its last value, at a clean step for its size (…25/50/75/00)
    const m = Math.max(...line[1]) || 1;
    const unit = 25 * 10 ** Math.max(String(Math.trunc(m)).length - 3, 0);
    const ltop = Math.ceil(m / unit) * unit;
    const n = labels.length;
    const pts = line[1].map((v, i) => `${(((i + 0.5) * 1000) / n).toFixed(1)},${(300 - (300 * v) / ltop).toFixed(1)}`).join(" ");
    overlay = `<svg class="ch-line" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">`
      + `<polyline points="${pts}" pathLength="1" style="stroke:${line[2]}"/></svg>`
      + line[1].map((v, i) => `<i class="ch-dot" style="--d:${dotAt(i, n)};left:${(((i + 0.5) * 100) / n).toFixed(2)}%;bottom:${pct(v, ltop)};background:${line[2]}"></i>`).join("")
      + `<div class="ch-y right" aria-hidden="true">${[0, 1, 2, 3, 4].map((k) =>
        `<span style="bottom:${pct((ltop * k) / 4, ltop)}">${esc(k === 4 ? f.num(ltop) : tick(f, (ltop * k) / 4, 2))}</span>`).join("")}</div>`
      + `<b class="line-end" style="bottom:${pct(line[1][line[1].length - 1] || 0, ltop)}">${esc(line[0])} ${esc(fmt(line[1][line[1].length - 1] || 0))}</b>`;
  }
  const xs = labels.map((lab, i) => (i % every === 0 ? `<span${Math.floor(i / every) % 2 ? ' class="alt"' : ""}>${esc(lab)}</span>` : "<span></span>")).join("");
  const keys = line ? `<span class="axis-key bar" style="background:${series[0][2]}" aria-hidden="true"></span>`
    + `<span class="axis-key line" style="background:${line[2]}" aria-hidden="true"></span>` : "";
  const summary = `${o.label}: ` + labels.flatMap((lab, i) => (totals[i] ? [`${lab} ${fmt(totals[i])}`] : [])).join(", ");
  return `<figure class="vchart${line ? " has-line" : ""}${o.colTips ? " col-tips" : ""}" role="img" aria-label="${esc(summary)}">`
    + `<div class="ch-plot">${keys}${yaxis(f, top, steps)}<div class="ch-cols" style="--n:${labels.length}">${cols.join("")}</div>${overlay}</div>`
    + `<div class="ch-x${labels.length > 8 ? " edge" : ""}" style="--n:${labels.length}" aria-hidden="true">${xs}</div>`
    + (o.xtitle ? `<figcaption class="ch-title">${esc(o.xtitle)}</figcaption>` : "") + "</figure>";
}

/** A running total at the end of each label, as dots joined by a line (the plain line charts' look), each column's
 * whole strip opening its tip. */
/** A dot's place from the left, 0 to 1: the dots draw in in that order (dash.css). */
const dotAt = (i: number, n: number) => (n > 1 ? i / (n - 1) : 0).toFixed(3);

export function qline(f: Fmt, labels: string[], values: number[], o: { label: string; color: string; tips: string[]; emptyText?: string }): string {
  if (!labels.length) return empty(o.emptyText || "");
  // one even step from the lowest to the highest (0 always in): four of them over the span, rounded up
  // whole points: the smallest round step that covers the span in at most five (12.5 was no balance anyone has)
  const lo = Math.min(0, ...values), hi = Math.max(1, ...values);
  let step = 1;
  for (let mag = 1; ; mag *= 10) {
    const m = [1, 2, 5].find((k) => Math.ceil(hi / (k * mag)) - Math.floor(lo / (k * mag)) <= 5);
    if (m) { step = m * mag; break; }
  }
  const bot = -Math.floor(lo / step) * step, top = Math.ceil(hi / step) * step, span = top + bot;
  const at = (v: number) => (100 * (v + bot)) / span; // % from the bottom
  const steps = Array.from({ length: Math.round(span / step) + 1 }, (_, k) => -bot + k * step);
  const ticks = steps.map((v) => `<span style="bottom:${at(v).toFixed(2)}%">${esc(tick(f, v, v % 1 ? 1 : 0))}</span>`).join("");
  const n = labels.length;
  const cols = labels.map((_, i) => `<div class="ch-col ql"${tipAttr(o.tips[i])}></div>`).join("");
  const pts = values.map((v, i) => `${(((i + 0.5) * 1000) / n).toFixed(1)},${(300 - 3 * at(v)).toFixed(1)}`).join(" ");
  const line = `<svg class="ch-line" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" pathLength="1" style="stroke:${o.color}"/></svg>`
    + (n > 100 ? "" : values.map((v, i) => `<i class="ch-dot" style="--d:${dotAt(i, n)};left:${(((i + 0.5) * 100) / n).toFixed(2)}%;bottom:${at(v).toFixed(2)}%;background:${o.color}"></i>`).join("")); // day by day over a year: the line alone
  const every = Math.max(1, Math.ceil(n / 8));
  // counted back from the last label, so the last month (or week) always shows
  const xs = labels.map((lab, i) => ((n - 1 - i) % every === 0 ? `<span${((n - 1 - i) / every) % 2 ? ' class="alt"' : ""}>${esc(lab)}</span>` : "<span></span>")).join(""); // alt: narrow charts show every other one
  return `<figure class="vchart qline col-tips" role="img" aria-label="${esc(o.label)}">`
    + `<div class="ch-plot"><div class="ch-y" aria-hidden="true">${ticks}</div>${bot ? `<i class="ch-zero" style="top:${((100 * top) / span).toFixed(2)}%"></i>` : ""}`
    + `<div class="ch-cols" style="--n:${n}">${cols}</div>${line}</div>`
    + `<div class="ch-x${n > 8 ? " edge" : ""}" style="--n:${n}" aria-hidden="true">${xs}</div></figure>`;
}

type HOpts = {
  label: string; end?: (i: number, v: number) => string; extra?: (i: number) => string | null | undefined;
  tips?: string[]; emptyText?: string; big?: boolean; min?: number; // min: the scale never ends below it (a few small values stay short)
};

/** Horizontal stacked bars, one row per label, the total at the bar's end. */
export function hbars(f: Fmt, labels: string[], series: Series[], o: HOpts): string {
  if (!labels.length) return empty(o.emptyText || "");
  const totals = labels.map((_, i) => series.reduce((s, [, v]) => s + (v[i] || 0), 0));
  const top = Math.max((Math.max(...totals.map(Math.abs)) || 1) * 1.3, o.min || 0); // the longest bar leaves room for its end label
  const end = o.end || ((_: number, v: number) => f.num(v, Number.isInteger(v) ? 0 : 2));
  const rows = labels.map((lab, i) => {
    const tip = o.tips ? o.tips[i] : [lab, ...series.flatMap(([n, v]) => (v[i] ? [`${n} ${f.num(v[i], 2)}`] : []))].join(" · ");
    // a negative value (points taken away) draws as long as it is, in red
    const segs = series.filter(([, v]) => v[i]).map(([, v, c], k) => `<i style="width:${pct(Math.abs(v[i] || 0), top)};background:${(v[i] || 0) < 0 ? BAD : c};--k:${k}"${tipAttr(tip)}></i>`).join("");
    const x = o.extra?.(i);
    return `<div class="hb-row"><span class="hb-label">${esc(lab)}</span><span class="hb-track">${segs}<b>${esc(end(i, totals[i]))}`
      + `${x ? `<span class=hb-extra> · ${esc(x)}</span>` : ""}</b></span></div>`;
  });
  const summary = `${o.label}: ` + labels.map((lab, i) => `${lab} ${end(i, totals[i])}`).join(", ");
  return `<figure class="hchart${o.big ? " big" : ""}" role="img" aria-label="${esc(summary)}">${rows.join("")}</figure>`;
}

/** Month labels under a time axis: one per real month, under its middle (the 15th), every k-th counted back from the
 * month the data ends in, which always shows, right-aligned so it ends at its place (at the edge when its 15th is past). */
function monthTicks(f: Fmt, lo: number, hi: number, end: number) {
  const span = hi - lo, mid = (t: number, k: number) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 15, 12); };
  const months: number[] = [], last = mid(end, 0);
  // up to the month the data ends in (named at the edge when it ends before its 15th), never the margin after it
  for (let k = 0, t = mid(lo, 0); t <= last; t = mid(lo, ++k)) if (t >= lo) months.push(t);
  if (months.at(-1) !== last) months.push(last);
  const every = Math.max(1, Math.round(months.length / 8));
  return months.filter((_, i) => (months.length - 1 - i) % every === 0).map((t, i, xs) =>
    `<span${i === xs.length - 1 ? ' class="end"' : ""} style="left:${((100 * (Math.min(t, hi) - lo)) / span).toFixed(2)}%">${esc(f.monthOf(t))}</span>`).join("");
}

/** Time series as SVG lines over an HTML axis. */
export function lines(f: Fmt, series: [string, Point[], string][], o: { label: string; step?: boolean; emptyText?: string; to?: number }): string {
  const step = o.step ?? true;
  const pts = series.flatMap(([, ps]) => ps);
  if (!pts.length) return empty(o.emptyText || "");
  let lo = Math.min(...pts.map((p) => p.x)), hi = Math.max(...pts.map((p) => p.x), o.to ?? 0); // to: the lines carry on flat up to that day
  const end = hi, pad = Math.max((hi - lo) * 0.02, 864e5);
  lo -= pad; hi += pad;
  const top = niceMax(Math.max(...pts.map((p) => p.y)));
  const X = (x: number) => (1000 * (x - lo)) / (hi - lo), Y = (y: number) => 300 - (300 * y) / top;
  const paths = series.filter(([, ps]) => ps.length).map(([, ps, c]) => {
    const d: string[] = [];
    let prev: number | null = null;
    for (const p of [...ps].sort((a, b) => a.x - b.x)) {
      if (prev !== null && step) d.push(`L${X(p.x).toFixed(1)},${Y(prev).toFixed(1)}`);
      d.push(`${d.length ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`);
      prev = p.y;
    }
    d.push(`L${X(hi).toFixed(1)},${Y(prev!).toFixed(1)}`);
    return `<path d="${d.join(" ")}" pathLength="1" style="stroke:${c}"/>`;
  });
  const n = 40, slices: string[] = [];
  for (let k = 0; k < n; k++) { // the value of every series at the end of each slice
    const at = lo + ((hi - lo) * (k + 1)) / n;
    const vals = series.map(([name, ps]) => {
      const before = ps.filter((p) => p.x <= at);
      return `${name} ${f.num(before.length ? before[before.length - 1].y : 0, 1)}`;
    });
    slices.push(`<i${tipAttr(f.stamp(at).split(",")[0] + " · " + vals.join(" · "))}></i>`);
  }
  const last = series.filter(([, ps]) => ps.length).map(([name, ps]) => `${name} ${f.num(ps[ps.length - 1].y, 1)}`).join(", ");
  return `<figure class="lchart" role="img" aria-label="${esc(`${o.label}: ${last}`)}">`
    + `<div class="ch-plot">${yaxis(f, top)}<svg class="ch-lines" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">`
    + `${paths.join("")}</svg><div class="ch-hover" style="--n:${n}">${slices.join("")}</div></div>`
    + `<div class="ch-months" aria-hidden="true">${monthTicks(f, lo, hi, end)}</div></figure>`;
}

/** Gantt rows on one shared time axis: [row label, [start ms, end ms, colour, tip][]]. */
export function timeline(f: Fmt, rows: [string, [number, number, string, string][]][], o: { label: string; emptyText?: string }): string {
  const spans = rows.flatMap(([, ss]) => ss);
  if (!spans.length) return empty(o.emptyText || "");
  const pad = 7 * 864e5;
  const lo = Math.min(...spans.map((s) => s[0])) - pad, hi = Math.max(...spans.map((s) => Math.max(s[0], s[1]))) + pad;
  const span = hi - lo;
  const body = rows.map(([name, ss]) => {
    const bars = ss.map(([a, b, c, tip]) =>
      `<i style="left:${((100 * (a - lo)) / span).toFixed(2)}%;width:max(4px,${((100 * (Math.max(a, b) - a)) / span).toFixed(2)}%);background:${c}"${tipAttr(tip)}></i>`).join("");
    return `<div class="tl-row"><span class="tl-label" title="${esc(name)}">${esc(name)}</span><span class="tl-track">${bars}</span></div>`;
  });
  return `<figure class="timeline" role="img" aria-label="${esc(o.label)}">${body.join("")}`
    + `<div class="tl-axis" aria-hidden="true"><span></span><span class="ch-months">${monthTicks(f, lo, hi, hi - pad)}</span></div></figure>`;
}

