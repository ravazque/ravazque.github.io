// Coalition (student period only): where the coalitions of Madrid stand and every point you gave yours, the logtime
// bonus in detail and every bonus so far, and your points by source and month.
import { madridParts } from "../fmt";
import { BAD, S1, legend, vbars } from "../lib/charts";
import { esc, safeColor, tipAttr } from "../lib/h";
import { leaving, rule, tierRows, weekFigure } from "./bonus";
import { Page, Section, block, cols, fillRows, headBlock, info, monthsBetween, msOf, section } from "./page";

const when = (pg: Page, iso: string) => `<span class="nw">${esc(pg.f.stamp(msOf(iso)))}</span>`;

const isTig = (a: any) => a.key === "other" && a.points < 0;
const SOURCES = ["evaluations", "projects", "exams", "logtime_50", "logtime_80", "wallet", "other", "tigs"];

/** Each source's colour, the same in the sources and in the months (which need no key of their own): the page's accent,
 * a tone of it toward the text for the hours (the logtime bonuses: darker in light mode, lighter in dark), red for TIGs. */
const sourceColor = (key: string, base: string) =>
  key === "tigs" ? BAD : key.startsWith("logtime") ? `color-mix(in oklab, ${base} 55%, var(--ink))` : base;

/** The sources of your points: one bar split by share (points given), then a row for every source, the ones at nothing
 * too (an empty square, grey), with its colour, points, share and awards (TIGs in red, last). */
function sourcesShare(f: Page["f"], src: any[], tone: (k: string) => string): string {
  const sum = src.reduce((t, s) => t + Math.max(0, s.points), 0), share = (p: number) => (sum && p > 0 ? (100 * p) / sum : 0);
  const name = (s: any) => f.t(`coal.src.${s.key}`);
  const meta = (s: any) => [s.points > 0 ? `${f.num(share(s.points), 1)}%` : "", f.plural(s.count, "coal.awards")].filter(Boolean).join(" · ");
  const tip = (s: any) => [name(s), f.num(s.points), meta(s)].join(" · ");
  return `<div class="src-share"><div class="src-stack" role="img" aria-label="${esc(src.filter((s) => s.points).map(tip).join("; "))}">`
    + src.map((s) => (s.points > 0 ? `<i style="width:${share(s.points).toFixed(2)}%;background:${tone(s.key)}"${tipAttr(tip(s))}></i>` : "")).join("") + "</div>"
    + `<ul class="src-list">${src.map((s) => `<li${s.points ? "" : ' class="zero"'}${tipAttr(tip(s))}><i class="sw"${s.points ? ` style="background:${tone(s.key)}"` : ""}></i>`
      + `<span class="src-name">${esc(name(s))}</span><span class="src-meta">${esc(meta(s))}</span>`
      + `<b${s.points < 0 ? ' class="neg"' : ""}>${esc(f.num(s.points))}</b></li>`).join("")}</ul></div>`;
}

/** Points per month by source, from every award (TIGs apart): one row per source with points, a value per month asked;
 * null for a report saved before every award was kept. */
export function monthsBySource(P: any, months: string[]): Record<string, number[]> | null {
  if (!Array.isArray(P.awards)) return null;
  const at = new Map(months.map((m, i) => [m, i])), out: Record<string, number[]> = {};
  for (const a of P.awards) {
    const i = at.get(madridParts(msOf(a.at)).iso.slice(0, 7)), key = isTig(a) ? "tigs" : a.key;
    if (i === undefined || !a.points) continue;
    (out[key] ||= months.map(() => 0))[i] += a.points;
  }
  return out;
}

export const everySource = (src: any[]) => [...src, ...SOURCES.filter((key) => !src.some((s) => s.key === key)).map((key) => ({ key, points: 0, count: 0 }))]
  .sort((a, b) => b.points - a.points);

/** Points taken away are TIGs (the API's CommunityService; reports keep them under "other"), told apart from the rest of
 * "other" by source and by month. A report without every award can't tell: it stays as it was. */
export function tigSplit(P: any): { sources: any[]; months: any[] } {
  const tigs = (P.awards || []).filter(isTig);
  const byMonth = new Map<string, number>();
  for (const a of tigs) { const k = madridParts(msOf(a.at)).iso.slice(0, 7); byMonth.set(k, (byMonth.get(k) || 0) + a.points); }
  const months = (P.months || []).map((m: any) => { const t = byMonth.get(m.month) || 0; return { ...m, other: m.other - t, tigs: t }; });
  if (!tigs.length) return { sources: P.sources || [], months };
  const sum = tigs.reduce((s: number, a: any) => s + a.points, 0);
  const sources = P.sources.flatMap((s: any) => (s.key !== "other" ? [s] : s.count > tigs.length ? [{ ...s, points: s.points - sum, count: s.count - tigs.length }] : []));
  return { sources: [...sources, { key: "tigs", points: sum, count: tigs.length }], months };
}

export function coalition(pg: Page): Section[] {
  const f = pg.f, D = pg.D, dv = pg.v.derive || {};
  const out: Section[] = [];

  const C = pg.v.coalitions || [];
  const recent = allPoints(pg);
  if (C.length || recent) {
    const best = Math.max(1, ...C.map((c: any) => c.score));
    // with the intra's banners and logos (newer reports): one strip per coalition, else the bars as before
    const img = (u: string) => `/api/me/coalition-image?u=${encodeURIComponent(u)}`;
    const banners = C.some((c: any) => c.cover);
    const coal = C.map((c: any) => banners
      ? `<li class="${c.mine ? "mine" : ""}" style="--coal:${safeColor(c.color)}">`
        + (c.cover ? `<img class="cover" src="${esc(img(c.cover))}" alt="" loading="lazy" data-fallback>` : "")
        + `<span class="rank">${esc(c.rank)}</span>`
        + (c.logo ? `<img class="logo" src="${esc(img(c.logo))}" alt="" data-fallback>` : `<i class="logo" aria-hidden="true"></i>`)
        + `<span class="name">${esc(c.name)}</span><span class="num">${f.num(c.score)}</span>`
        + `<span class="track" aria-hidden="true"><b style="width:${((100 * c.score) / best).toFixed(1)}%"></b></span></li>`
      : `<li class="${c.mine ? "mine" : ""}"><span class="rank">${esc(c.rank)}</span><span class="name"><i style="background:${safeColor(c.color)}"></i>`
        + `${esc(c.name)}</span><span class="track"><b style="width:${((100 * c.score) / best).toFixed(1)}%;`
        + `background:${safeColor(c.color)}"></b></span><span class="num">${f.num(c.score)}</span></li>`).join("");
    out.push({ id: "standing", nav: f.t("nav.standing"), html: section("standing", f.t("standing.title"), cols(
      C.length ? block("coalitions", `<ol class="standings${banners ? " banners" : ""}">${coal}</ol>`, f.t("standing.coalitions")) : "",
      recent ? `<div class="block recent" data-panel="coal-recent"><h3>${esc(f.t("standing.recent"))}</h3>`
        + `<ol class="list" tabindex="0" aria-label="${esc(f.t("standing.recent"))}">${recent}</ol></div>` : "")) });
  }

  // the logtime bonus in detail (inferred rule) and every bonus given so far
  const W = D.logtime_bonus, tiers = dv.logtime_bonus as any[] | null, P = D.coalition_points;
  if (W && tiers && pg.period !== "piscine") {
    const sessions = W.sessions || [], week = tiers[0].window_h, drops = dv.logtime_drops || [];
    const status = [W.open && sessions.length ? f.t("coal.s_open", { since: when(pg, sessions.reduce((a: any, b: any) => (b[1] > a[1] ? b : a))[0]) }) : esc(f.t("coal.s_closed")), f.t("coal.s_as_of", { time: when(pg, W.at) })].join(" · ");
    const detail = `<div class="tp bonus-detail">${weekFigure(f, week)}<p class="line note">${status}</p>${rule(f, week)}${tierRows(f, tiers, !!W.open, week, drops)}`
      + `${leaving(f, drops, D.logtime?.log || [])}</div>`;
    const bonuses = P?.bonuses || [];
    const list = bonuses.map((b: any) => `<li><span><b>${esc(f.t("bonus.got", { hours: b.hours }))}</b><br><span class="note">${esc(f.stamp(msOf(b.at)))}</span></span>`
      + `<span class="when">+${esc(f.num(b.points))}</span></li>`).join("") || `<li class="note">${esc(f.t("bonus.none"))}</li>`;
    out.push({ id: "bonus", nav: f.t("bonus.title"), html: section("bonus", "", cols(block("coal-bonus", detail),
      block("bonus-history", `<ol class="list" tabindex="0" aria-label="${esc(f.t("bonus.history"))}">${list}${fillRows(bonuses.length, f.t("bonus.room"))}</ol>`, f.t("bonus.history"),
        bonuses.length ? f.t("bonus.history_note", { n: f.plural(bonuses.length, "coal.awards"), points: f.num(bonuses.reduce((s: number, b: any) => s + b.points, 0)) }) : "")),
    { head: `<h2>${esc(f.t("bonus.title"))} ${info(f.t("bonus.rule"))}</h2>` }) });
  }

  if (P) {
    const { sources, months: split } = tigSplit(P), src = everySource(sources), byMonth = new Map<string, any>(split.map((m: any) => [m.month, m]));
    // the months up to the report's, the quiet ones as zero
    const months = split.length ? monthsBetween(split[0].month, [split[split.length - 1].month, pg.asOf.slice(0, 7)].sort()[1])
      .map((k) => byMonth.get(k) || { month: k, logtime: 0, other: 0, tigs: 0 }) : [];
    const month = (m: string) => `${f.months[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
    const given = src.filter((s: any) => s.points);
    const bySource = monthsBySource(P, months.map((m: any) => m.month));
    const base = S1, tone = (k: string) => sourceColor(k, base); // the page's accent: the 42 blue, or the coalition's when chosen
    const minus = src.some((s: any) => s.points < 0) || months.some((m: any) => m.logtime < 0 || m.other < 0);
    const tigName = f.t("coal.src.tigs"), anyTig = months.some((m: any) => m.tigs < 0);
    // every month stacked by source, in the sources' colours (TIGs in red at their size); a report saved before every award
    // was kept falls back to logtime and the rest
    const order = [...given.map((s: any) => s.key), ...Object.keys(bySource || {}).filter((k) => !given.some((s: any) => s.key === k))];
    const monthSeries: [string, number[], string][] = bySource
      ? order.filter((k) => bySource[k]).map((k) => [f.t(`coal.src.${k}`), bySource[k].map((v) => (k === "tigs" ? -v : v)), tone(k)])
      : [[f.t("coal.src.logtime"), months.map((m: any) => m.logtime), tone("logtime")], [f.t("coal.rest"), months.map((m: any) => m.other), base],
        ...(anyTig ? [[tigName, months.map((m: any) => -m.tigs), BAD] as [string, number[], string]] : [])];
    const monthTips = months.map((m: any, i: number) => (bySource
      ? [f.monthLabel(m.month), ...order.filter((k) => bySource[k]?.[i]).map((k) => `${f.t(`coal.src.${k}`)}: ${f.num(bySource[k][i])}`)]
      : [f.monthLabel(m.month), `${f.t("coal.src.logtime")} ${f.num(m.logtime)}`, `${f.t("coal.rest")} ${f.num(m.other)}`, ...(m.tigs ? [`${tigName}: ${f.num(m.tigs)}`] : [])]).join("\n"));
    const total = f.t("coal.total", { points: f.num(P.total || 0), n: f.plural(P.count || 0, "coal.awards"),
      coalition: D.profile?.coalition?.name || "–", span: split.length ? f.t("coal.span", { first: month(split[0].month), last: month(split[split.length - 1].month) }) : f.t("empty.period") });
    out.push({ id: "coal-points", nav: f.t("nav.coal"), html: section("coal-points", f.t("coal.title"), cols(
      // what your points are made of: one bar split by source, then every source with its points, share and awards, in its
      // colour (the key to the months beside it)
      block("coal-sources", sourcesShare(f, src, tone), f.t("coal.sources")),
      // stacked by source, the bars beside are its key; the older two-part chart keeps a key of its own
      ((chart: string) => (bySource ? block("coal-months", chart, f.t("coal.months")) : headBlock("coal-months", f.t("coal.months"), legend(monthSeries.map(([n, , c]) => [n, c])), chart)))(
        vbars(f, months.map((m: any) => f.monthLabel(m.month)), monthSeries,
          { label: f.t("coal.months"), stacked: true, tight: true, colTips: !!bySource, fmt: (v) => f.num(v), tips: monthTips, every: Math.ceil(months.length / 6) || 1, emptyText: f.t("empty.period") }))),
    { lede: esc(total) + (minus ? ` ${esc(f.t("coal.minus"))}` : "") }) });
  }
  return out;
}

/** Every award to the coalition (the latest 40 in reports saved before), newest first, each with the project,
 * evaluation or exam it came from. */
export function allPoints(pg: Page): string {
  const f = pg.f;
  const recent = pg.D.coalition_points?.awards || pg.D.coalition_points?.recent;
  if (!recent?.length) return "";
  const names = new Map<string, string>();
  for (const p of pg.allProjects) {
    names.set(`projects|${p.pu_id}`, p.name);
    for (const a of p.attempts) names.set(`exams|${a.team_id}`, p.name);
  }
  for (const e of pg.D.given) names.set(`evaluations|${e.id}`, e.project);
  return recent.map((r: any) => {
    const name = names.get(`${r.key}|${r.id}`);
    const what = isTig(r) ? f.t("coal.src.tigs") : name || r.key.startsWith("logtime") ? f.t(`coal.why.${r.key}`, { name: name || "" }) : f.t(`coal.src.${r.key}`);
    const pts = r.points < 0 ? `<span class="when neg">${esc(f.num(r.points))}</span>` : `<span class="when">+${esc(f.num(r.points))}</span>`;
    return `<li><span>${esc(what)}<br><span class="note">${esc(f.stamp(msOf(r.at)))}</span></span>${pts}</li>`;
  }).join("") + fillRows(recent.length, f.t("standing.room"));
}
