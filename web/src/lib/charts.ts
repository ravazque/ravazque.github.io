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

export const legend = (items: [string, string][]) =>
  `<div class="legend">${items.map(([l, c]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join("")}</div>`;

export const empty = (text: string) => `<p class="note chart-empty">${esc(text)}</p>`;

/** An axis tick: thousands as "k" from 10,000 up, so six-digit scales fit a phone's axis. */
const tick = (f: Fmt, v: number, d: number) => (Math.abs(v) >= 10000 ? `${f.num(v / 1000, 1)}k` : f.num(v, d));

function yaxis(f: Fmt, top: number) {
  const q = top / 4;
  const d = q % 1 === 0 ? 0 : (q * 10) % 1 === 0 ? 1 : 2; // quarter ticks keep their decimals
  return `<div class="ch-y" aria-hidden="true">${[0, 1, 2, 3, 4]
    .map((k) => `<span style="bottom:${pct((top * k) / 4, top)}">${esc(tick(f, (top * k) / 4, d))}</span>`).join("")}</div>`;
}

type VOpts = {
  label: string; stacked?: boolean; xtitle?: string; peak?: string; line?: [string, number[], string]; barTips?: boolean;
  fmt?: (v: number) => string; every?: number; tips?: string[]; emptyText?: string;
};

/** Vertical bars per label, side by side or stacked; line draws over the bars on its own right-hand scale. */
export function vbars(f: Fmt, labels: string[], series: Series[], o: VOpts): string {
  if (!labels.length || !series.some(([, vals]) => vals.some((v) => v))) return empty(o.emptyText || "");
  const fmt = o.fmt || ((v: number) => f.num(v, 1));
  const totals = labels.map((_, i) =>
    o.stacked ? series.reduce((s, [, v]) => s + (v[i] || 0), 0) : Math.max(...series.map(([, v]) => v[i] || 0)));
  const top = niceMax(Math.max(...totals));
  const every = o.every || Math.max(1, Math.ceil(labels.length / 12));
  const best = totals.indexOf(Math.max(...totals));
  const colTip = series.length === 1 && !o.stacked && !o.barTips; // one series: the whole column opens the tip
  const line = o.line;
  const cols = labels.map((lab, i) => {
    const tip = o.tips ? o.tips[i]
      : [lab, ...series.map(([n, v]) => `${n} ${fmt(v[i] || 0)}`), ...(line ? [`${line[0]} ${fmt(line[1][i])}`] : [])].join(" · ");
    const bars = series.map(([, v, c]) =>
      `<i style="height:${pct(v[i] || 0, top)};background:${c}"${v[i] && !colTip ? tipAttr(tip) : ""}></i>`).join("");
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
      + line[1].map((v, i) => `<i class="ch-dot" style="left:${(((i + 0.5) * 100) / n).toFixed(2)}%;bottom:${pct(v, ltop)};background:${line[2]}"></i>`).join("")
      + `<div class="ch-y right" aria-hidden="true">${[0, 1, 2, 3, 4].map((k) =>
        `<span style="bottom:${pct((ltop * k) / 4, ltop)}">${esc(k === 4 ? f.num(ltop) : tick(f, (ltop * k) / 4, 2))}</span>`).join("")}</div>`
      + `<b class="line-end" style="bottom:${pct(line[1][line[1].length - 1] || 0, ltop)}">${esc(line[0])} ${esc(fmt(line[1][line[1].length - 1] || 0))}</b>`;
  }
  const xs = labels.map((lab, i) => (i % every === 0 ? `<span${Math.floor(i / every) % 2 ? ' class="alt"' : ""}>${esc(lab)}</span>` : "<span></span>")).join("");
  const keys = line ? `<span class="axis-key bar" style="background:${series[0][2]}" aria-hidden="true"></span>`
    + `<span class="axis-key line" style="background:${line[2]}" aria-hidden="true"></span>` : "";
  const summary = `${o.label}: ` + labels.flatMap((lab, i) => (totals[i] ? [`${lab} ${fmt(totals[i])}`] : [])).join(", ");
  return `<figure class="vchart${line ? " has-line" : ""}" role="img" aria-label="${esc(summary)}">`
    + `<div class="ch-plot">${keys}${yaxis(f, top)}<div class="ch-cols" style="--n:${labels.length}">${cols.join("")}</div>${overlay}</div>`
    + `<div class="ch-x" style="--n:${labels.length}" aria-hidden="true">${xs}</div>`
    + (o.xtitle ? `<figcaption class="ch-title">${esc(o.xtitle)}</figcaption>` : "") + "</figure>";
}

type HOpts = {
  label: string; end?: (i: number, v: number) => string; extra?: (i: number) => string | null | undefined;
  tips?: string[]; emptyText?: string; big?: boolean; min?: number; // min: the scale never ends below it (a few small values stay short)
};

/** Horizontal stacked bars, one row per label, the total at the bar's end. */
export function hbars(f: Fmt, labels: string[], series: Series[], o: HOpts): string {
  if (!labels.length) return empty(o.emptyText || "");
  const totals = labels.map((_, i) => series.reduce((s, [, v]) => s + (v[i] || 0), 0));
  const top = Math.max((Math.max(...totals) || 1) * 1.3, o.min || 0); // the longest bar leaves room for its end label
  const end = o.end || ((_: number, v: number) => f.num(v, Number.isInteger(v) ? 0 : 2));
  const rows = labels.map((lab, i) => {
    const tip = o.tips ? o.tips[i] : [lab, ...series.flatMap(([n, v]) => (v[i] ? [`${n} ${f.num(v[i], 2)}`] : []))].join(" · ");
    const segs = series.filter(([, v]) => v[i]).map(([, v, c]) => `<i style="width:${pct(v[i] || 0, top)};background:${c}"${tipAttr(tip)}></i>`).join("");
    const x = o.extra?.(i);
    return `<div class="hb-row"><span class="hb-label">${esc(lab)}</span><span class="hb-track">${segs}<b>${esc(end(i, totals[i]))}`
      + `${x ? `<span class=hb-extra> · ${esc(x)}</span>` : ""}</b></span></div>`;
  });
  const summary = `${o.label}: ` + labels.map((lab, i) => `${lab} ${end(i, totals[i])}`).join(", ");
  return `<figure class="hchart${o.big ? " big" : ""}" role="img" aria-label="${esc(summary)}">${rows.join("")}</figure>`;
}

function monthTicks(f: Fmt, lo: number, hi: number) {
  const span = hi - lo, out: string[] = [];
  const step = Math.max(1, Math.round(span / 864e5 / 30 / 8)) * 30 * 864e5;
  // a tick too close to the right edge would be cut: it is left out
  for (let t = lo + step / 2; t < hi && (t - lo) / span < 0.95; t += step) out.push(`<span style="left:${((100 * (t - lo)) / span).toFixed(2)}%">${esc(f.monthOf(t))}</span>`);
  return out.join("");
}

/** Time series as SVG lines over an HTML axis. */
export function lines(f: Fmt, series: [string, Point[], string][], o: { label: string; step?: boolean; emptyText?: string }): string {
  const step = o.step ?? true;
  const pts = series.flatMap(([, ps]) => ps);
  if (!pts.length) return empty(o.emptyText || "");
  let lo = Math.min(...pts.map((p) => p.x)), hi = Math.max(...pts.map((p) => p.x));
  const pad = Math.max((hi - lo) * 0.02, 864e5);
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
    + `<div class="ch-months" aria-hidden="true">${monthTicks(f, lo, hi)}</div></figure>`;
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
    + `<div class="tl-axis" aria-hidden="true"><span></span><span class="ch-months">${monthTicks(f, lo, hi)}</span></div></figure>`;
}

/** A module's recent history under its figure: a hairline or thin columns, the newest in the accent when last. */
export function trend(values: (number | null)[], o: { bars?: boolean; last?: boolean } = {}): string {
  const vals = values.map((v) => Math.max(0, v || 0)).slice(-24); // deductions (net points below zero) draw as nothing
  if (vals.length < 2 || !vals.some(Boolean)) return "";
  const top = Math.max(...vals) || 1, n = vals.length;
  let marks: string;
  if (o.bars) {
    const w = 100 / n;
    marks = vals.map((v, i) => `<rect x="${(i * w + w * 0.18).toFixed(2)}" y="${(40 - (38 * v) / top).toFixed(2)}" width="${(w * 0.64).toFixed(2)}" height="${((38 * v) / top).toFixed(2)}"${o.last && i === n - 1 ? ' class="now"' : ""}/>`).join("")
      + '<line class="base" x1="0" y1="40" x2="100" y2="40"/>';
  } else {
    marks = `<polyline points="${vals.map((v, i) => `${((100 * i) / (n - 1)).toFixed(2)},${(40 - (38 * v) / top).toFixed(2)}`).join(" ")}" pathLength="1"/>`;
  }
  return `<svg class="trend${o.bars ? " bars" : ""}" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">${marks}</svg>`;
}
