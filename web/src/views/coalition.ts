// Coalition: where the coalitions of Madrid stand and what you last gave yours, the logtime bonus in detail and every
// bonus so far, and your points by source and month.
import { S1, S2, hbars, legend, vbars } from "../lib/charts";
import { esc, safeColor } from "../lib/h";
import { Page, Section, block, cols, headBlock, info, kpis, monthsBetween, msOf, section } from "./page";

const when = (pg: Page, iso: string) => `<span class="nw">${esc(pg.f.stamp(msOf(iso)))}</span>`;

export function coalition(pg: Page): Section[] {
  const f = pg.f, D = pg.D, dv = pg.v.derive || {};
  const out: Section[] = [];

  const C = pg.v.coalitions || [];
  const recent = recentPoints(pg);
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
    const mineC = D.profile.coalition;
    const mineLine = mineC ? [mineC.name, mineC.rank ? f.t("standing.coal_rank", { n: mineC.rank }) : "", mineC.score !== null && mineC.score !== undefined ? f.t("standing.coal_score", { n: f.num(mineC.score) }) : "",
      mineC.master ? f.t("standing.coal_master") : ""].filter(Boolean).join(" · ") : "";
    out.push({ id: "standing", nav: f.t("nav.standing"), html: section("standing", f.t("standing.title"), cols(
      C.length ? block("coalitions", `<ol class="standings${banners ? " banners" : ""}">${coal}</ol>`, f.t("standing.coalitions")) : "",
      recent ? `<div class="block recent" data-panel="coal-recent"><h3>${esc(f.t("standing.recent"))}</h3>`
        + `<ol class="list" tabindex="0" aria-label="${esc(f.t("standing.recent"))}">${recent}</ol></div>` : ""),
    { lede: mineLine ? `<b>${esc(f.t("standing.mine"))}:</b> ${esc(mineLine)}` : "" }) });
  }

  // the logtime bonus in detail (inferred rule) and every bonus given so far
  const W = D.logtime_bonus, tiers = dv.logtime_bonus as any[] | null, P = D.coalition_points;
  if (W && tiers && pg.period !== "piscine") {
    const sessions = W.sessions || [];
    const items: [string, string, string[]][] = [[f.t("coal.k_window"), `${f.num(tiers[0].window_h, 1)}<small> h</small>`,
      [W.open && sessions.length ? f.t("coal.s_open", { since: when(pg, sessions[sessions.length - 1][0]) }) : esc(f.t("coal.s_closed")), f.t("coal.s_as_of", { time: when(pg, W.at) })]]];
    for (const t of tiers) {
      const p = Math.min(100, (100 * t.window_h) / t.hours);
      const meter = `<span class="hbar" aria-hidden="true"><i style="width:${p.toFixed(1)}%"></i></span>` + esc(f.t("coal.s_meter", { have: f.num(t.window_h, 1), need: t.hours }));
      const head = ({ ready: esc(f.t("coal.v_ready")), cooldown: esc(f.t("coal.v_cooldown")), short: `${f.num(t.need_h, 1)}<small> ${esc(f.t("coal.v_short"))}</small>` } as Record<string, string>)[t.state];
      const until = t.state === "ready" && W.open ? esc(f.t("coal.s_next_logout"))
        : t.until && t.until !== t.from ? f.t(W.open ? "coal.s_until" : "coal.s_login_until", { time: when(pg, t.until) }) : "";
      items.push([f.t("coal.k_tier", { hours: t.hours, points: f.num(t.points) }), head,
        [meter, t.from ? f.t("coal.s_from", { time: when(pg, t.from) }) : "", until, t.last ? f.t("coal.s_last", { time: when(pg, t.last) }) : esc(f.t("coal.s_never"))]]);
    }
    const bonuses = P?.bonuses || [];
    const list = bonuses.map((b: any) => `<li><span><b>${esc(f.t("bonus.got", { hours: b.hours }))}</b><br><span class="note">${esc(f.stamp(msOf(b.at)))}</span></span>`
      + `<span class="when">+${esc(f.num(b.points))}</span></li>`).join("") || `<li class="note">${esc(f.t("bonus.none"))}</li>`;
    out.push({ id: "bonus", nav: f.t("bonus.title"), html: section("bonus", "", cols(block("coal-bonus", kpis(items)),
      block("bonus-history", `<ol class="list" tabindex="0" aria-label="${esc(f.t("bonus.history"))}">${list}</ol>`, f.t("bonus.history"),
        bonuses.length ? f.t("bonus.history_note", { n: f.plural(bonuses.length, "coal.awards"), points: f.num(bonuses.reduce((s: number, b: any) => s + b.points, 0)) }) : "")),
    { head: `<h2>${esc(f.t("bonus.title"))} ${info(f.t("bonus.rule"))}</h2>` }) });
  }

  if (P && P.count) {
    const src = P.sources, byMonth = new Map<string, any>(P.months.map((m: any) => [m.month, m]));
    // the months up to the report's, the quiet ones as zero
    const months = P.months.length ? monthsBetween(P.months[0].month, [P.months[P.months.length - 1].month, pg.asOf.slice(0, 7)].sort()[1])
      .map((k) => byMonth.get(k) || { month: k, logtime: 0, other: 0 }) : [];
    const month = (m: string) => `${f.months[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
    const names = src.map((s: any) => f.t(`coal.src.${s.key}`));
    const minus = src.some((s: any) => s.points < 0) || months.some((m: any) => m.logtime < 0 || m.other < 0);
    const total = f.t("coal.total", { points: f.num(P.total), n: f.plural(P.count, "coal.awards"),
      coalition: D.profile.coalition?.name || "–", span: P.months.length ? f.t("coal.span", { first: month(P.months[0].month), last: month(P.months[P.months.length - 1].month) }) : f.t("empty.period") });
    out.push({ id: "coal-points", nav: f.t("nav.coal"), html: section("coal-points", f.t("coal.title"), cols(
      block("coal-sources", `<div class="centred">${hbars(f, names, [[f.t("coal.points"), src.map((s: any) => s.points), S1]],
        { label: f.t("coal.sources"), end: (_i, v) => f.num(v), tips: names.map((n: string, i: number) => `${n} · ${f.num(src[i].points)} · ${f.plural(src[i].count, "coal.awards")}`),
          emptyText: f.t("empty.period"), big: true })}</div>`, f.t("coal.sources")),
      headBlock("coal-months", f.t("coal.months"), legend([[f.t("coal.src.logtime"), S1], [f.t("coal.rest"), S2]]), vbars(f, months.map((m: any) => f.monthLabel(m.month)),
        [[f.t("coal.src.logtime"), months.map((m: any) => m.logtime), S1], [f.t("coal.rest"), months.map((m: any) => m.other), S2]],
        { label: f.t("coal.months"), stacked: true, fmt: (v) => f.num(v), every: Math.ceil(months.length / 6) || 1, emptyText: f.t("empty.period") }))),
    { lede: esc(total) + (minus ? ` ${esc(f.t("coal.minus"))}` : "") }) });
  }
  return out;
}

/** The latest awards to the coalition, newest first, each with the project, evaluation or exam it came from. */
function recentPoints(pg: Page): string {
  const f = pg.f;
  const recent = pg.D.coalition_points?.recent;
  if (!recent?.length) return "";
  const names = new Map<string, string>();
  for (const p of pg.allProjects) {
    names.set(`projects|${p.pu_id}`, p.name);
    for (const a of p.attempts) names.set(`exams|${a.team_id}`, p.name);
  }
  for (const e of pg.D.given) names.set(`evaluations|${e.id}`, e.project);
  return recent.map((r: any) => {
    const name = names.get(`${r.key}|${r.id}`);
    const what = name || r.key.startsWith("logtime") ? f.t(`coal.why.${r.key}`, { name: name || "" }) : f.t(`coal.src.${r.key}`);
    return `<li><span>${esc(what)}<br><span class="note">${esc(f.stamp(msOf(r.at)))}</span></span><span class="when">+${esc(f.num(r.points))}</span></li>`;
  }).join("");
}
