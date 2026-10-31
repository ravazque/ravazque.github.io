// Seat plans, heatmaps, the calendar, the skills radar, the Connections bubbles and the circle ring, as markup.
import type { Fmt } from "../fmt";
import { esc, tipAttr } from "./h";

export const GROUPS = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06", "outer-core", "alumni", "blackholed", "staff", "no-cursus"];
export const ACCENT: [string, string] = ["var(--ramp-hi)", "var(--ramp-lo)"];
export const SLATE: [string, string] = ["var(--slate)", "var(--slate-lo)"];

export const ramp = (v: number, top: number) => (top ? Math.sqrt(v / top) : 0);
export const mix = (c: [string, string], v: number) => `color-mix(in oklab, ${c[0]} ${(v * 100).toFixed(1)}%, ${c[1]})`;

export function scale(f: Fmt, top: number, unit: string, colors = ACCENT) {
  return `<span class="grp"><i style="background:var(--seat-empty)"></i>${esc(f.t("scale.none"))}</span>`
    + `<span class="grp">${esc(f.t("scale.less"))}${[0, 0.25, 0.5, 0.75, 1].map((s) => `<i style="background:${mix(colors, s)}"></i>`).join("")}`
    + `${esc(f.t("scale.more", { max: f.num(top, 1), unit }))}</span>`;
}

const roving = (f: Fmt, label: string) => ` data-roving role="group" aria-label="${esc(f.t("a11y.grid", { label }))}"`;

export type Layout = Record<string, { rows: number; seats: number }>;

/** [plan with the off-plan note under it, scale] for {host: value}; detail(host, value) is the cell's label. */
export function seatPlan(f: Fmt, layout: Layout, values: Record<string, number>, o: {
  unit: string; detail: (h: string, v: number) => string; toUnit?: (v: number) => number; anchor?: boolean;
}): [string, string] {
  const toUnit = o.toUnit || ((v: number) => v);
  const entries = Object.entries(values);
  const top = Math.max(0, ...entries.map(([, v]) => v));
  const topHost = top ? entries.find(([, v]) => v === top)?.[0] : undefined;
  const seen = new Set<string>(), out: string[] = [];
  for (const [c, shape] of Object.entries(layout)) {
    let total = 0;
    const rows: string[] = [];
    for (let r = 1; r <= shape.rows; r++) {
      const cells: string[] = [];
      for (let s = 1; s <= shape.seats; s++) {
        const host = `${c}r${r}s${s}`, v = values[host];
        if (!v) { cells.push('<span class="seat"></span>'); continue; }
        total += v;
        seen.add(host);
        const d = o.detail(host, v), label = d + (host === topHost ? `${d.includes("\n") ? "\n" : " · "}${f.t("plan.most_used_short")}` : "");
        cells.push(`<span class="seat on${host === topHost ? " top" : ""}"${o.anchor ? ` id="seat-${esc(host)}"` : ""} data-cell`
          + ` role="img" style="--v:${ramp(v, top).toFixed(3)}" aria-label="${esc(label)}"${tipAttr(label)}></span>`);
      }
      rows.push(`<div class="row" style="--seats:${shape.seats}"><span class="rn" aria-hidden="true">r${r}</span>${cells.join("")}</div>`);
    }
    out.push(`<figure class="cluster"><figcaption><b>${esc(c)}</b><span>${f.num(toUnit(total), 1)} ${esc(o.unit)}</span></figcaption>${rows.join("")}</figure>`);
  }
  // computers outside the clusters: under the plan, centred in a framed key, each name beside a square in its shade
  const other = entries.filter(([h]) => !seen.has(h));
  const off = other.length ? `<div class="plan-other"><b>${esc(f.t("plan.off"))}</b>${other.map(([h, v]) => {
    const label = o.detail(h, v);
    return `<span class="grp"><span>${esc(`${h} · ${f.num(toUnit(v), 1)} ${o.unit}`)}</span><span class="seat on${h === topHost ? " top" : ""}" data-cell role="img"`
      + ` style="--v:${ramp(v, top).toFixed(3)}" aria-label="${esc(label)}"${tipAttr(label)}></span></span>`;
  }).join("")}</div>` : "";
  let sc = top ? scale(f, toUnit(top), o.unit) : `<span>${esc(f.t("empty.period"))}</span>`;
  if (topHost)
    sc += `<span class="grp"><i style="background:var(--seat-empty);box-shadow:inset 0 0 0 1.5px var(--highlight)"></i>${esc(f.t("plan.most_used", { seat: topHost }))}</span>`;
  return [`<div class="plan"${roving(f, f.t("plan.label"))}>${out.join("")}</div>${off}`, `<div class="scale">${sc}</div>`];
}

/** A weekday × hour heat map; each cell says its value. */
export function heat(f: Fmt, grid: number[][], colors: [string, string], unit: string): string {
  const top = Math.max(0, ...grid.flat());
  const cells = ["<span></span>", ...Array.from({ length: 24 }, (_, h) => `<span class="h" aria-hidden="true">${h % 3 ? "" : h}</span>`)];
  grid.forEach((row, w) => {
    cells.push(`<span>${esc(f.weekdays[w])}</span>`);
    row.forEach((v, h) => {
      if (!v) { cells.push('<span class="c"></span>'); return; }
      const label = `${f.weekdays[w]} ${String(h).padStart(2, "0")}:00 · ${f.num(v, 1)} ${unit}`;
      cells.push(`<span class="c" data-cell role="img" aria-label="${esc(label)}"${tipAttr(label)} style="background:${mix(colors, ramp(v, top))}"></span>`);
    });
  });
  return `<div class="heat"${roving(f, f.t("heat.label"))}>${cells.join("")}</div>`;
}

const dayNo = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;

export function calendar(f: Fmt, days: string[], hours: number[]): string {
  const top = Math.max(0, ...hours);
  const years = new Map<string, [string, number][]>();
  days.forEach((d, i) => { const y = d.slice(0, 4); if (!years.has(y)) years.set(y, []); years.get(y)!.push([d, hours[i]]); });
  const out: string[] = [];
  const firstDay = days[0], lastDay = days[days.length - 1];
  for (const [y, data] of years) {
    // every year is a full rectangle of weeks, Monday to Sunday: the days outside the data (before the start, after
    // the last day, in the neighbouring years) are plain empty cells, so the current year fills in as the days come
    const have = new Map(data);
    const jan1 = dayNo(`${y}-01-01`), len = dayNo(`${+y + 1}-01-01`) - jan1;
    const offset = (new Date(Date.UTC(+y, 0, 1)).getUTCDay() + 6) % 7;
    const cols = Math.floor((offset + len - 1) / 7) + 1;
    const col = (m: number) => Math.floor((dayNo(`${y}-${String(m).padStart(2, "0")}-01`) - jan1 + offset) / 7) + 1;
    // a month's label spans 4 columns: one that would touch the next label gives way to it
    const starts = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, col: col(i + 1) }));
    const kept = starts.filter((x, i) => !starts[i + 1] || starts[i + 1].col - x.col >= 4);
    const months = kept.map(({ m, col }) => `<span class="m" style="grid-area:1/${col}/2/span 4">${esc(f.months[m - 1])}</span>`).join("");
    const cells = Array.from({ length: cols * 7 }, (_, i) => {
      const d = new Date((jan1 - offset + i) * 864e5).toISOString().slice(0, 10);
      const area = `grid-area:${(i % 7) + 2}/${Math.floor(i / 7) + 1}`;
      if (i < offset || i >= offset + len || d < firstDay || d > lastDay) return `<span class="d pre" style="${area}"></span>`;
      const v = have.get(d) || 0, start = d === firstDay;
      const label = `${f.day(d, true)} · ${v ? `${f.num(v, 1)} h` : f.t("calendar.not_logged")}${start ? ` · ${f.t("calendar.start")}` : ""}`;
      return v ? `<span class="d on${start ? " start" : ""}" data-cell role="img" style="${area};--v:${ramp(v, top).toFixed(3)}" aria-label="${esc(label)}"${tipAttr(label)}></span>`
        : `<span class="d${start ? " start" : ""}" style="${area}"${tipAttr(label)}></span>`;
    }).join("");
    out.push(`<div class="cal-year"><b>${y}</b><div class="cal-grid" style="--cols:${cols}">${months}${cells}</div></div>`);
  }
  const body = out.join("") || `<p class="note">${esc(f.t("empty.sessions"))}</p>`;
  return `<div id="calendar"${roving(f, f.t("calendar.label"))}>${body}</div>`;
}

export type Skill = { name: string; level: number };

/** The skills radar: a ringed polygon with the skill names around it; the bars beside it carry the values. */
export function radar(f: Fmt, items: Skill[], label: string, compact = false): string {
  const [W, H] = compact ? [400, 380] : [560, 440];
  const cx = W / 2, cy = H / 2, r = 150, n = items.length;
  const top = Math.max(5, Math.ceil(Math.max(0, ...items.map((s) => s.level)) / 5) * 5);
  const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / n;
  const pt = (i: number, v: number) => {
    const k = Math.max(0, Math.min(1, (v || 0) / top));
    return [cx + k * r * Math.cos(ang(i)), cy + k * r * Math.sin(ang(i))];
  };
  const lh = 15, gap = 4, wrap = 15;
  const placed = items.map((s, i) => {
    const a = ang(i), d = r + (compact ? 16 : 22);
    const x = cx + d * Math.cos(a), y = cy + d * Math.sin(a);
    const anchor = Math.cos(a) > 0.08 ? "start" : Math.cos(a) < -0.08 ? "end" : "middle";
    let ls: string[];
    if (compact) ls = [String(i + 1)];
    else {
      ls = [""];
      for (const w of s.name.split(" ")) {
        const lastLine = ls[ls.length - 1];
        if (lastLine && `${lastLine} ${w}`.length > wrap) ls.push(w);
        else ls[ls.length - 1] = `${lastLine} ${w}`.trim();
      }
    }
    const h = ls.length * lh;
    const topY = Math.sin(a) < -0.5 && anchor === "middle" ? y - h : Math.sin(a) > 0.5 && anchor === "middle" ? y + 4 : y - h / 2;
    return { x, top: topY, h, anchor, ls };
  });
  if (!compact) for (const side of ["start", "end"]) {
    const col = placed.filter((p) => p.anchor === side).sort((a, b) => a.top - b.top);
    for (let k = 1; k < col.length; k++) col[k].top = Math.max(col[k].top, col[k - 1].top + col[k - 1].h + gap);
  }
  const rings = [1, 2, 3, 4].map((k) => `<circle class="ring" cx="${cx}" cy="${cy}" r="${(r * k) / 4}"/>`).join("");
  const spokes = items.map((_, i) => `<line class="spoke" x1="${cx}" y1="${cy}" x2="${pt(i, top)[0].toFixed(1)}" y2="${pt(i, top)[1].toFixed(1)}"/>`).join("");
  const shape = items.map((s, i) => `${pt(i, s.level)[0].toFixed(1)},${pt(i, s.level)[1].toFixed(1)}`).join(" ");
  const dots = items.map((s, i) => (s.level ? `<circle class="dot" cx="${pt(i, s.level)[0].toFixed(1)}" cy="${pt(i, s.level)[1].toFixed(1)}" r="3.5" data-tip="${esc(s.name)} · ${f.num(s.level, 2)}"><title>${esc(s.name)} · ${f.num(s.level, 2)}</title></circle>` : "")).join("");
  const labels = placed.map((p) => `<text class="label${compact ? " num" : ""}" x="${p.x.toFixed(1)}" y="${(p.top + lh - 3).toFixed(1)}" text-anchor="${p.anchor}">`
    + p.ls.map((line, k) => `<tspan x="${p.x.toFixed(1)}" dy="${k ? lh : 0}">${esc(line)}</tspan>`).join("") + "</text>").join("");
  const aria = `${label}: ` + items.map((s) => `${s.name} ${f.num(s.level, 2)}`).join(", ");
  return `<svg class="radar${compact ? " compact" : ""}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${rings}${spokes}<polygon class="shape" points="${shape}"/>${dots}${labels}</svg>`;
}

const LABEL_BAND = 28;
/** How tight Connections packs its bubbles and how far apart its rows sit: --bubbles-gap, --bubbles-edge and
 * --bubbles-rows in styles/spacing.css (the defaults here only serve where no stylesheet is loaded, as in tests). */
export function bubbleSpacing() {
  const css = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
  const num = (name: string, d: number) => { const v = parseFloat(css?.getPropertyValue(name) || ""); return Number.isFinite(v) ? v : d; };
  return { gap: num("--bubbles-gap", 3), edge: num("--bubbles-edge", 8), rows: num("--bubbles-rows", 28) };
}
type Spacing = ReturnType<typeof bubbleSpacing>;
type Cell = { x: number; y: number; top: number; bottom: number; left: number; right: number };

function cellsFor(groups: string[], width: number, sizes: Record<string, number>, minW: Record<string, number> = {}, grow = 1, rowGap = 0): Map<string, Cell> {
  // milestones on the first band, where people are after the Common Core (Outer Core, alumni, blackholed…) on the next
  const present = GROUPS.filter((g) => groups.includes(g));
  const bands = [present.filter((g) => g.startsWith("rank-")), present.filter((g) => !g.startsWith("rank-"))].filter((b) => b.length);
  const rowsOf = (b: string[]) => { const per = width < 600 ? 2 : b.length > 5 ? Math.ceil(b.length / 2) : b.length; return Array.from({ length: Math.ceil(b.length / per) }, (_, i) => b.slice(i * per, (i + 1) * per)); };
  const rowList = bands.flatMap(rowsOf);
  const out = new Map<string, Cell>();
  let top = 0;
  for (const members of rowList) {
    const raw = members.map((g) => Math.sqrt(sizes[g] || 1));
    const weights = raw.map((w) => Math.max(w, 0.35 * Math.max(...raw)));
    const sum = weights.reduce((a, b) => a + b, 0);
    // each zone is at least as wide as its name; what is left is shared by area
    const mins = members.map((g) => Math.min(minW[g] || 0, width / members.length));
    const rest = width - mins.reduce((a, b) => a + b, 0);
    const widths = weights.map((w, i) => mins[i] + (rest * w) / sum);
    // a group is roughly a disc of its bubbles' area: the row holds its width-spread area and its diameter
    const need = Math.max(...members.map((g, i) => LABEL_BAND + grow * Math.max((Math.PI * (sizes[g] || 1)) / 0.6 / widths[i], 2 * Math.sqrt((sizes[g] || 1) / 0.6) + 12)));
    const bottom = top + need + 12;
    let left = 0;
    members.forEach((g, i) => {
      out.set(g, { x: left + widths[i] / 2, y: (top + LABEL_BAND + bottom) / 2, top, bottom, left, right: left + widths[i] });
      left += widths[i];
    });
    top = bottom + rowGap;
  }
  return out;
}

type Bubble = { login: string; name?: string | null; group: string; dir: string; count: number; r: number; p: any; x: number; y: number };

/** Bubbles of one group as a cluster: the biggest in the middle of its zone, each next one pushed outwards (golden-angle
 * spiral) until it touches none, kept inside the zone below its name. False when one found no free spot (at once with
 * giveUp, the rest left unplaced). */
export function pack(nodes: Bubble[], cell: Cell, giveUp = false, sp: Spacing = bubbleSpacing()): boolean {
  const placed: Bubble[] = [];
  const cy = cell.top + LABEL_BAND + (cell.bottom - cell.top - LABEL_BAND) / 2;
  const turns = (Math.hypot(cell.right - cell.left, cell.bottom - cell.top) / 6.4) ** 2; // the spiral reaches the zone's corners
  let ok = true;
  for (const n of [...nodes].sort((a, b) => b.r - a.r)) {
    const e = sp.edge, [x0, x1, y0, y1] = [cell.left + n.r + e, cell.right - n.r - e, cell.top + LABEL_BAND + n.r + 4, cell.bottom - n.r - 6];
    let x = cell.x, y = cy, free = false;
    for (let k = 0; k < turns && !free; k++) {
      const a = k * 2.39996, d = 3.2 * Math.sqrt(k);
      x = cell.x + d * Math.cos(a); y = cy + d * Math.sin(a);
      if (x < x0 || x > x1 || y < y0 || y > y1) continue; // outside the zone: only spots inside it are tried
      free = placed.every((p) => (x - p.x) ** 2 + (y - p.y) ** 2 >= (n.r + p.r + sp.gap) ** 2);
    }
    if (!free) { x = Math.min(Math.max(x, x0), x1); y = Math.min(Math.max(y, y0), y1); }
    if (!free && giveUp) return false;
    ok &&= free;
    n.x = x; n.y = y;
    placed.push(n);
  }
  return ok;
}

export type Conn = { login: string; name?: string | null; group: string; received: number; given: number; last?: string | null };

/** Connections: one bubble per person (two in "mix", joined by a line), sized by evaluations, grouped by rank. */
export function bubbles(f: Fmt, people: Conn[], mode: string, o: { width: number; href: (l: string) => string }): string {
  const nodes: Bubble[] = [];
  for (const p of people) for (const d of mode === "mix" ? ["received", "given"] : [mode]) {
    const c = (p as any)[d] as number;
    if (c) nodes.push({ login: p.login, name: p.name, group: p.group, dir: d, count: c, r: 10 + 6 * Math.sqrt(c), p, x: 0, y: 0 });
  }
  if (!nodes.length) return "";
  const sizes: Record<string, number> = {};
  const sp = bubbleSpacing();
  for (const n of nodes) sizes[n.group] = (sizes[n.group] || 0) + (n.r + sp.gap / 2 + 0.5) ** 2;
  const name = (g: string) => `${f.t(`groups.${g}`)} · [${new Set(nodes.filter((n) => n.group === g).map((n) => n.login)).size}]`;
  const boxW = (t: string) => t.length * 8.6 + 18; // shortcut: width estimated from the label's length, close enough for these short names
  const minW = Object.fromEntries(Object.keys(sizes).map((g) => [g, boxW(name(g)) + 24]));
  // the zones grow until every group fits without a bubble on another
  let grow = 1, cells = cellsFor(Object.keys(sizes), o.width, sizes, minW, grow, sp.rows);
  while (grow < 3 && ![...cells].every(([g, cell]) => pack(nodes.filter((n) => n.group === g), cell, true, sp)))
    cells = cellsFor(Object.keys(sizes), o.width, sizes, minW, (grow += 0.2), sp.rows);
  if (grow >= 3) for (const [g, cell] of cells) pack(nodes.filter((n) => n.group === g), cell, false, sp);
  const h = Math.max(...[...cells.values()].map((c) => Math.ceil(c.bottom)), ...nodes.map((n) => Math.ceil(n.y + n.r + 6)));
  const at = new Map(nodes.map((n) => [`${n.login}|${n.dir}`, n]));
  const links = nodes.filter((n) => mode === "mix" && n.dir === "received" && at.has(`${n.login}|given`)).map((n) => {
    const g = at.get(`${n.login}|given`)!;
    return `<line class="link" x1="${n.x.toFixed(1)}" y1="${n.y.toFixed(1)}" x2="${g.x.toFixed(1)}" y2="${g.y.toFixed(1)}"/>`;
  }).join("");
  const labels = [...cells].map(([g, c]) => {
    const t = name(g), w = boxW(t);
    return `<rect class="group-box" x="${(c.x - w / 2).toFixed(1)}" y="${(c.top + 2).toFixed(1)}" width="${w.toFixed(1)}" height="24"/>`
      + `<text class="group-label" text-anchor="middle" x="${c.x.toFixed(1)}" y="${(c.top + 19).toFixed(1)}">${esc(t)}</text>`;
  }).join("");
  // the heartbeat runs through each group from its biggest bubble to its smallest, the groups out of step
  const order = new Map<Bubble, [number, number]>();
  [...cells.keys()].forEach((g, gi) => nodes.filter((n) => n.group === g).sort((a, b) => b.r - a.r).forEach((n, k) => order.set(n, [gi, k])));
  const marks = nodes.map((n) => {
    const p = n.p;
    const tip = [p.login, p.name, f.t("connections.tip_counts", { received: p.received || 0, given: p.given || 0 }), f.t(`groups.${p.group}`),
      p.last ? f.t("connections.tip_last", { when: f.day(p.last) }) : null].filter(Boolean).join("\n");
    const [g, i] = order.get(n)!;
    return `<a href="${esc(o.href(p.login))}" class="bubble ${n.dir} net-node ${netClass(p.group)}" style="--g:${g};--i:${i}" data-cell aria-label="${esc(tip)}" data-tip="${esc(tip)}"`
      + ` transform="translate(${n.x.toFixed(1)},${n.y.toFixed(1)})"><title>${esc(tip)}</title><circle class="core" r="${n.r.toFixed(1)}"/></a>`;
  }).join("");
  return `<svg class="graph" viewBox="0 0 ${o.width} ${h}" style="aspect-ratio:${o.width}/${h}"${roving(f, f.t("connections.title"))}>`
    + `<g class="labels">${labels}</g><g class="links">${links}</g><g class="nodes">${marks}</g></svg>`;
}

export const netClass = (g: string) =>
  ({ me: "me", "outer-core": "outer", alumni: "alumni", blackholed: "dead", staff: "staff" } as Record<string, string>)[g] || ((g || "").startsWith("rank-") ? "rank" : "none");

function trim(x1: number, y1: number, cx: number, cy: number, by: number) {
  const dx = cx - x1, dy = cy - y1, d = Math.hypot(dx, dy) || 1;
  return [x1 + (dx * by) / d, y1 + (dy * by) / d];
}

export type Net = { nodes: { login: string; group: string }[]; links: { source: string; target: string; count: number }[] };

/** Your circle: you in the centre, contacts on a ring ordered by group; arrows go from corrector to evaluated. */
export function ring(f: Fmt, net: Net, o: { width: number; height: number; compact: boolean; uid?: string }): string {
  const pairs = new Map<string, { a: string; b: string; ab: number; ba: number }>();
  for (const l of net.links || []) {
    const [a, b] = [l.source, l.target].sort();
    const key = `${a}\u0000${b}`;
    if (!pairs.has(key)) pairs.set(key, { a, b, ab: 0, ba: 0 });
    const p = pairs.get(key)!;
    if (l.source === a) p.ab += l.count; else p.ba += l.count;
  }
  const degree: Record<string, number> = {};
  for (const p of pairs.values()) {
    degree[p.a] = (degree[p.a] || 0) + p.ab + p.ba;
    degree[p.b] = (degree[p.b] || 0) + p.ab + p.ba;
  }
  const k = o.compact ? 0.6 : 1;
  const radius = (n: { login: string; group: string }) => (n.group === "me" ? 16 : 6 + Math.min(10, Math.sqrt(degree[n.login] || 0) * 1.4)) * k;
  const me = (net.nodes || []).filter((n) => n.group === "me");
  const gi = (g: string) => (GROUPS.includes(g) ? GROUPS.indexOf(g) : 99);
  const others = (net.nodes || []).filter((n) => n.group !== "me")
    .sort((a, b) => gi(a.group) - gi(b.group) || (degree[b.login] || 0) - (degree[a.login] || 0));
  const cx = o.width / 2, cy = o.height / 2;
  const R = Math.max(80, Math.min(o.width, o.height) / 2 - (o.compact ? 22 : 70));
  type P = { login: string; group: string; x: number; y: number; a: number; r: number };
  const at = new Map<string, P>();
  for (const n of me) at.set(n.login, { ...n, x: cx, y: cy, a: 0, r: radius(n) });
  others.forEach((n, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / others.length;
    at.set(n.login, { ...n, a, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), r: radius(n) });
  });
  const marker = `arr-${o.uid || "c"}`;
  const meLogin = me[0]?.login ?? null;
  const chords: string[] = [], arrows: string[] = [];
  for (const c of pairs.values()) {
    const p = at.get(c.a), q = at.get(c.b);
    if (!p || !q) continue;
    const mx = (p.x + q.x) / 4 + cx / 2, my = (p.y + q.y) / 4 + cy / 2;
    const [x1, y1] = trim(p.x, p.y, mx, my, p.r + 1), [x2, y2] = trim(q.x, q.y, mx, my, q.r + 1);
    const both = c.ab && c.ba;
    const ends = (c.ab ? ` marker-end="url(#${marker})"` : "") + (c.ba ? ` marker-start="url(#${marker})"` : "");
    const tip = [c.ab ? `${c.a} → ${c.b} ×${c.ab}` : "", c.ba ? `${c.b} → ${c.a} ×${c.ba}` : ""].filter(Boolean).join(" · ");
    const d = `M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
    const [out, back] = c.a === meLogin ? [c.ab, c.ba] : [c.ba, c.ab];
    const dir = meLogin && (c.a === meLogin || c.b === meLogin) ? ` data-dir="${out && back ? "both" : out ? "out" : "in"}"` : "";
    chords.push(`<path class="${both ? "both" : "one"}" data-a="${esc(c.a)}" data-b="${esc(c.b)}"${dir} data-tip="${esc(tip)}"`
      + ` stroke-width="${Math.min(5, 1 + (c.ab + c.ba) / 3).toFixed(1)}" d="${d}"><title>${esc(tip)}</title></path>`);
    arrows.push(`<path data-a="${esc(c.a)}" data-b="${esc(c.b)}"${dir}${ends} d="${d}"/>`);
  }
  const marks: string[] = [], centre: string[] = [];
  for (const n of at.values()) {
    const d = degree[n.login] || 0;
    const tip = n.group === "me" ? n.login : [n.login, f.t(`groups.${n.group}`), f.t("network.tip", { count: d, n: d })].join(" · ");
    let text = "";
    const meText = n.group === "me" ? `<text y="${(n.r + 18).toFixed(1)}" text-anchor="middle">${esc(n.login)}</text>` : "";
    if (n.group !== "me" && !o.compact) {
      const anchor = Math.cos(n.a) > 0.15 ? "start" : Math.cos(n.a) < -0.15 ? "end" : "middle";
      // clear of its node: under it the cap height, over it the descenders also need room
      const sin = Math.sin(n.a);
      text = `<text x="${((n.r + 7) * Math.cos(n.a)).toFixed(1)}" y="${((n.r + 7) * sin + 4 + 6 * sin).toFixed(1)}" text-anchor="${anchor}">${esc(n.login)}</text>`;
    }
    // the tip opens outwards from the centre, so it never covers the rest of the circle
    const side = n.group === "me" ? "" : ` data-angle="${((n.a * 180) / Math.PI).toFixed(1)}"`;
    (n.group === "me" ? centre : marks).push(`<g class="net-node ${netClass(n.group)}" data-login="${esc(n.login)}" data-cell role="img"${side}`
      + ` aria-label="${esc(tip)}" data-tip="${esc(tip)}" transform="translate(${n.x.toFixed(1)},${n.y.toFixed(1)})">`
      + `<title>${esc(tip)}</title><circle class="core" r="${n.r.toFixed(1)}"/>${text}</g>`);
    if (n.group === "me") // chords pass over you; over your circle the pointer still means you
      // your name is drawn over the chords, on the layer that catches the pointer
      marks.push(`<g class="net-node me-hit" data-login="${esc(n.login)}" data-tip="${esc(tip)}" transform="translate(${n.x.toFixed(1)},${n.y.toFixed(1)})"><title>${esc(tip)}</title><circle r="${(n.r + 2).toFixed(1)}"/>${meText}</g>`);
  }
  const defs = `<defs><marker id="${marker}" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="${o.compact ? 8 : 11}" markerHeight="${o.compact ? 8 : 11}" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" class="arrowhead"/></marker></defs>`;
  return `<svg class="graph net" data-me="${esc(meLogin || "")}" viewBox="0 0 ${o.width} ${o.height}"${roving(f, f.t("network.title"))}>${defs}`
    + `<g class="net-me">${centre.join("")}</g><g class="net-links">${chords.join("")}</g><g class="net-arrows">${arrows.join("")}</g><g class="net-nodes">${marks.join("")}</g></svg>`;
}
