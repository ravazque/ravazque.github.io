// Evaluations: what you give back, received and given over time, when and how long, statistics, feedback, correction
// points and the full log.
import { GOOD, BAD, S1, S2, legend, lines, vbars } from "../lib/charts";
import { ACCENT, SLATE, heat } from "../lib/graphs";
import { ARROW, avatar, esc } from "../lib/h";
import { facts, table } from "../lib/table";
import { KINDS, Page, Section, block, cols, failed, filters, flagBadge, info, kpis, noMark, radios, search, section, select } from "./page";

export function evaluations(pg: Page): Section[] {
  const f = pg.f, D = pg.D, S = D.summary, W = D.when;
  const out: Section[] = [];
  const role = pg.q("role", "received", ["received", "given"]);
  const base = role === "received" ? S1 : S2;
  const m = W[`${role}_monthly`];
  const lede = role === "received"
    ? f.t("received.lede", { n: S.received, mark: f.num(S.received_avg_mark, 1), outstanding: S.received_outstanding, pct: f.pct(S.received_outstanding, S.received), negative: S.received_negative })
    : f.t("given.lede", { n: S.given, mark: f.num(S.given_avg_mark, 1), outstanding: S.given_outstanding, negative: S.given_negative, rating: f.num(S.ratings_i_received.rating, 2) });
  const bins: [string, (x: number) => boolean][] = [["0", (x) => x === 0], ["1–49", (x) => x > 0 && x < 50], ["50–79", (x) => x >= 50 && x < 80], ["80–99", (x) => x >= 80 && x < 100],
    ["100", (x) => x === 100], ["101–124", (x) => x > 100 && x < 125], ["125", (x) => x >= 125]];
  const count = (evs: any[]) => bins.map(([, ok]) => evs.filter((e) => e.mark !== null && e.mark !== undefined && ok(e.mark)).length);
  const roles: [string, string][] = [[f.t("role.received"), S1], [f.t("role.given"), S2]];
  const cm = pg.v.derive?.community || { hours: 0, people: 0, correctors: 0, rating: null, rated: 0 };

  out.push({ id: "community", nav: f.t("community.title"), html: section("community", f.t("community.title"), cols(block("kpis", kpis([
    [f.t("community.k_hours"), esc(f.nb(cm.hours, "h")), [esc(f.t("community.s_hours", { n: f.num(D.given.length) }))]],
    [f.t("community.k_people"), f.num(cm.people), [esc(f.t("community.s_people"))]],
    [f.t("community.k_correctors"), f.num(cm.correctors), [esc(f.t("community.s_correctors"))]],
    [f.t("community.k_rating"), cm.rating !== null ? f.num(cm.rating, 2) : "–", [esc(f.t("community.s_rating", { n: f.num(cm.rated) }))]],
  ]))), { lede: esc(f.t("community.lede")) }) });

  const sw = pg.seg("role", [["received", f.t("role.received")], ["given", f.t("role.given")]], role, f.t("log.role_label"), "over-time");
  out.push({ id: "over-time", nav: f.t("over_time.title"), html: section("over-time", "", cols(
    block("recv-monthly", legend([[f.t("flag.ok"), base], [f.t("flag.outstanding"), GOOD], [f.t("flag.negative"), BAD]])
      + vbars(f, W.months.map((x: string) => f.monthLabel(x)), [[f.t("flag.ok"), m.ok, base], [f.t("flag.outstanding"), m.outstanding, GOOD], [f.t("flag.negative"), m.negative, BAD]],
        { label: f.t("received.monthly_title"), stacked: true, fmt: (v) => f.num(v), emptyText: f.t("empty.period") }),
    f.t(role === "received" ? "received.monthly_title" : "given.monthly_title")),
    block("marks", legend(roles) + vbars(f, bins.map(([b]) => b), [[f.t("role.received"), count(D.received), S1], [f.t("role.given"), count(D.given), S2]],
      { label: f.t("received.marks_title"), xtitle: f.t("received.final_mark"), fmt: (v) => f.num(v), emptyText: f.t("empty.period") }), f.t("received.marks_title")),
    block("cum-evals", legend(roles) + lines(f, [[f.t("role.received"), W.cum_received, S1], [f.t("role.given"), W.cum_given, S2]],
      { label: f.t("received.cum_title"), emptyText: f.t("empty.period") }), f.t("received.cum_title")),
    block("cum-out", legend(roles) + lines(f, [[f.t("received.out_received"), W.cum_out_received, S1], [f.t("received.out_given"), W.cum_out_given, S2]],
      { label: f.t("received.cum_out_title"), emptyText: f.t("empty.period") }), f.t("received.cum_out_title"))),
  { head: `<div class="panel-head"><h2>${esc(f.t("over_time.title"))}</h2>${sw}</div>`, lede: esc(lede) }) });

  const edges = (e: number[]) => e.map((x, i) => (i < e.length - 1 ? `${x}–${e[i + 1]}` : `${x}+`));
  const dp = D.insights?.evaluations;
  const dur = (d: any) => (d.avg === null || d.avg === undefined ? "–" : f.t("depth.minutes", { avg: f.num(d.avg), median: f.num(d.median) }));
  const factsHtml = dp ? `<dl class="facts">${facts([[f.t("depth.received_duration"), esc(dur(dp.received_duration))], [f.t("depth.given_duration"), esc(dur(dp.given_duration))],
    [f.t("depth.lead"), esc(dp.received_lead_h === null || dp.received_lead_h === undefined ? "–" : f.t("depth.hours", { h: f.num(dp.received_lead_h, 1) }))],
    [f.t("depth.streak"), f.num(dp.outstanding_streak)]])}</dl>` : "";
  const dq = pg.q("dq", "").slice(0, 80);
  out.push({ id: "when", nav: f.t("nav.when"), html: section("when", f.t("when.title"), factsHtml + cols(
    block("heat-recv", heat(f, W.heat_received, ACCENT, f.t("unit.evaluations")), f.t("when.heat_recv_title")),
    block("heat-given", heat(f, W.heat_given, SLATE, f.t("unit.evaluations")), f.t("when.heat_given_title")),
    `<div class="block" data-panel="duration"><h3>${esc(f.t("when.duration_title"))} ${info(f.t("when.duration_note"))}</h3>${legend(roles)}`
    + vbars(f, edges(W.duration_edges), [[f.t("role.received"), W.duration_received, S1], [f.t("role.given"), W.duration_given, S2]],
      { label: f.t("when.duration_title"), xtitle: f.t("when.minutes"), fmt: (v) => f.num(v), emptyText: f.t("empty.period") }) + "</div>",
    `<div class="block" data-panel="lead"><h3>${esc(f.t("when.lead_title"))} ${info(f.t("when.lead_note"))}</h3>${legend(roles)}`
    + vbars(f, edges(W.lead_edges), [[f.t("role.received"), W.lead_received, S1], [f.t("role.given"), W.lead_given, S2]],
      { label: f.t("when.lead_title"), xtitle: f.t("when.hours_before"), fmt: (v) => f.num(v), emptyText: f.t("empty.period") }) + "</div>",
    `<div class="block" data-panel="depth-projects" id="in-depth"><div class="block-head"><h3>${esc(f.t("depth.given_title"))}</h3>`
    + filters("depth", search("dq", dq, f.t("common.search"), f.t("depth.search_placeholder"))) + `</div>`
    + `<p class="note">${esc(f.t("depth.given_note"))}</p><div id="depth-results"><div class="table-wrap tall">${correctedTable(pg, dq)}</div></div></div>`),
  { lede: esc(f.t("when.lede", { recv: f.num(W.median_duration_received), given: f.num(W.median_duration_given), lead: f.num(W.median_lead_received, 1) })) }) });

  const st = D.stats;
  if (st) {
    const rate = (r: any, key: string) => `<div><p class="v">${r.pct === null || r.pct === undefined ? "–" : `${f.num(r.pct, 1)}<small>%</small>`}</p><p class="k">${esc(f.t(key))}</p>`
      + `<p class="s">${esc(f.t("stats.of", { n: r.n, total: r.total }))}</p></div>`;
    const R = st.outstanding_reciprocity;
    const order = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06", "outer-core", "alumni", "blackholed", "no-cursus"];
    const groups = Object.entries(st.by_group || {}).map(([g, v]: [string, any]) => ({ g, ...v, i: order.includes(g) ? order.indexOf(g) : 99,
      in_pct: v.received ? (100 * v.received_out) / v.received : null, out_pct: v.given ? (100 * v.given_out) / v.given : null }));
    const h = st.by_hour || [];
    const pctCell = (v: number | null) => (v === null ? "–" : `${f.num(v)}%`);
    out.push({ id: "correction-stats", nav: f.t("nav.correction_stats"), html: section("correction-stats", f.t("correction.title"), cols(
      block("fail-rates", `<div class="rates">${rate(st.failed_given, "stats.failed_given")}${rate(st.failed_received, "stats.failed_received")}`
        + `<div><h3>${esc(f.t("stats.reciprocity_title"))}</h3><p class="s">${esc(f.t("stats.recip_in", { back: R.i_gave_back, gave_me: R.gave_me }))}</p>`
        + `<p class="s">${esc(f.t("stats.recip_out", { back: R.they_gave_back, i_gave: R.i_gave }))}</p></div></div>`),
      groups.length ? `<div class="block" data-panel="by-group"><h3>${esc(f.t("stats.group_title"))} ${info(f.t("stats.group_note"))}</h3><div class="table-wrap">${table(f, [
        { k: "i", t: f.t("col.group"), f: (r) => esc(f.t(`groups.${r.g}`)) },
        { k: "received", t: f.t("col.received"), s: f.t("abbr.received"), num: true },
        { k: "in_pct", t: f.t("col.out_pct"), s: f.t("abbr.out_pct"), num: true, f: (r) => pctCell(r.in_pct) },
        { k: "given", t: f.t("col.given"), s: f.t("abbr.given"), num: true },
        { k: "out_pct", t: f.t("col.out_pct"), s: f.t("abbr.out_pct"), num: true, f: (r) => pctCell(r.out_pct) },
      ], groups, { label: f.t("stats.group_title"), sort: ["i", 1] })}</div></div>` : "",
      block("by-hour", `<div class="centred">${legend(roles)}${vbars(f, h.map((x: any) => String(x.hour).padStart(2, "0")),
        [[f.t("role.received"), h.map((x: any) => x.received), S1], [f.t("role.given"), h.map((x: any) => x.given), S2]],
        { label: f.t("stats.hour_title"), fmt: (v) => f.num(v), every: 3, emptyText: f.t("empty.period") })}</div>`, f.t("stats.hour_title"), f.t("stats.hour_note_ssr"))),
    { lede: esc(f.t("stats.lede")) }) });
  }

  // feedback: the criteria both ways, and every rating under the maximum you got as a corrector
  const me = D.profile.login;
  const mine = D.received.flatMap((e: any) => e.feedbacks.filter((x: any) => x.by === me));
  const theirs = D.given.flatMap((e: any) => e.feedbacks);
  const below = (fbs: any[], k: string, top: number) => fbs.filter((x) => x[k] !== null && x[k] !== undefined && x[k] < top).length;
  let crit = "";
  if (!pg.light) {
    const rows = [["overall", "rating", 5] as const, ...KINDS.map((k) => [k, k, 4] as const)].map(([lab, k, top]) => ({
      label: `${f.t(`criterion.${lab}`)} (/${top})`, mineAvg: S.my_rating_of_correctors[k], mineLow: below(mine, k, top),
      theirAvg: S.ratings_i_received[k], theirLow: below(theirs, k, top) }));
    crit = table(f, [{ k: "label", t: f.t("col.criterion") },
      { k: "mineAvg", t: f.t("col.you_to_correctors", { n: mine.length }), num: true, f: (r) => `${f.num(r.mineAvg, 2)}<span class="sub">${esc(f.t("feedback.below_max", { n: r.mineLow }))}</span>` },
      { k: "theirAvg", t: f.t("col.evaluated_to_you", { n: theirs.length }), num: true, f: (r) => `${f.num(r.theirAvg, 2)}<span class="sub">${esc(f.t("feedback.below_max", { n: r.theirLow }))}</span>` }],
    rows, { label: f.t("feedback.criteria_title") });
  }
  const rated = D.given.flatMap((e: any) => e.feedbacks.filter((x: any) => x.rating !== null && x.rating !== undefined).map((x: any) => ({ ...x, project: e.project, begin: e.begin })));
  const score = (x: any) => KINDS.reduce((s, k) => s + (x[k] ?? 4), 0);
  const low = rated.filter((x: any) => x.rating < 5 || KINDS.some((k) => x[k] !== null && x[k] !== undefined && x[k] < 4))
    .sort((a: any, b: any) => a.rating - b.rating || score(a) - score(b));
  const meter = (label: string, n: number | null | undefined, top: number, tip = "") => {
    const pips = Array.from({ length: top }, (_, i) => `<i class="${n !== null && n !== undefined && i < n ? "on" : ""}"></i>`).join("");
    const shown = n === null || n === undefined ? "–" : n;
    return `<div class="${n !== null && n !== undefined && n < top ? "low" : ""}"><dt title="${esc(tip || label)}">${esc(label)}</dt>`
      + `<dd><span class="pips" role="img" aria-label="${esc(f.t("feedback.pips", { label, n: shown, max: top }))}">${pips}</span><b>${shown}<small>/${top}</small></b></dd></div>`;
  };
  const lowItem = (x: any) => `<li class="fb-item"><p class="fb-head"><span>${esc(f.t("feedback.by", { login: x.by || "?", project: x.project }))}</span>`
    + `<span class="when">${esc(x.begin.slice(0, 10))}</span></p><dl class="fb-crit">${meter(f.t("feedback.overall"), x.rating, 5)}`
    + ["punctuality", "interested", "rigorous", "nice"].map((k) => meter(f.t(`feedback.c.${k}`), x[k], 4, f.t(`feedback.q.${k}`))).join("") + "</dl>"
    + ((x.comment || "").trim() ? `<p class="note fb-quote">“${esc(x.comment.trim())}”</p>` : "") + "</li>";
  const lowItems = low.map(lowItem).join("") || `<li class="note">${esc(f.t(rated.length ? "feedback.all_max" : "empty.ratings"))}</li>`;
  out.push({ id: "feedback", nav: f.t("nav.feedback"), html: section("feedback", f.t("feedback.title"), cols(
    crit ? block("table-feedback", `<div class="table-wrap">${crit}</div>`, f.t("feedback.criteria_title"), f.t("feedback.criteria_note")) : "",
    block("low-feedback", `<ul class="list">${lowItems}</ul>`, f.t("feedback.low_title"),
      rated.length ? f.t("feedback.low_note", { low: low.length, ratings: f.plural(rated.length, "count.ratings") }) : "")),
  { lede: esc(f.t("feedback.lede")) }) });

  const CP = D.correction_points;
  out.push({ id: "points", nav: f.t("nav.points"), html: section("points", f.t("points.title"), cols(
    block("points", lines(f, [[f.t("points.balance"), CP.series, S1]], { label: f.t("points.balance_title"), emptyText: f.t("empty.points") }), f.t("points.balance_title")),
    block("table-reasons", `<div class="table-wrap">${table(f, [{ k: "reason", t: f.t("col.reason") }, { k: "count", t: f.t("col.times"), num: true }, { k: "sum", t: f.t("col.net"), num: true }],
      Object.entries(CP.reasons || {}).map(([reason, v]: [string, any]) => ({ reason, ...v })), { label: f.t("points.reasons_title"), sort: ["count", -1] })}</div>`, f.t("points.reasons_title"))),
  { lede: esc(CP.series.length ? f.t("points.lede", { earned: CP.earned, spent: CP.spent, max: CP.max }) : f.t("empty.points")) }) });

  out.push(logSection(pg));
  return out;
}

/** The projects you corrected in this period: how often, how many people, the marks you gave. */
function correctedTable(pg: Page, dq: string): string {
  const f = pg.f, q = dq.toLowerCase();
  const by = new Map<string, any[]>();
  for (const e of pg.D.given) {
    if (q && !e.project.toLowerCase().includes(q)) continue;
    if (!by.has(e.project)) by.set(e.project, []);
    by.get(e.project)!.push(e);
  }
  const rows = [...by].map(([project, evs]) => {
    const marks = evs.filter((e) => e.mark !== null && e.mark !== undefined).map((e) => e.mark);
    const whom = new Map<string, any[]>();
    for (const e of evs) for (const c of e.correcteds || []) { const l = c.login || "?"; if (!whom.has(l)) whom.set(l, []); whom.get(l)!.push(e); }
    const begins = evs.map((e) => e.begin).sort();
    return { project, times: evs.length, people: whom.size, avg: marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : null,
      fails: evs.filter(failed).length, outstanding: evs.filter((e) => e.outstanding).length, first: begins[0].slice(0, 10),
      last: begins[begins.length - 1].slice(0, 10), whom, last_e: evs.reduce((a, b) => (b.begin > a.begin ? b : a)) };
  });
  const chip = (e: any) => {
    const state = e.mark === null || e.mark === undefined ? "open" : failed(e) ? "fail" : "pass";
    return `<span class="mark ${state}" title="${esc(e.begin.slice(0, 10))}">${e.mark !== null && e.mark !== undefined ? esc(e.mark) : noMark(f, e)}</span>`;
  };
  const detail = (r: any) => {
    const people = [...r.whom].sort((a: any, b: any) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const lis = people.map(([login, evs]: [string, any[]]) => `<li><a class="code" href="${esc(pg.url("evaluations", { q: login, log: "given" }))}#log">${esc(login)}</a>`
      + `${evs.length > 1 ? ` ×${evs.length}` : ""} <span class="marks">${[...evs].sort((a, b) => a.begin.localeCompare(b.begin)).map(chip).join("")}</span></li>`).join("");
    return `<details><summary>${esc(f.plural(r.people, "depth.whom"))}</summary><ul class="evals">${lis}</ul></details>`;
  };
  return table(f, [
    { k: "project", t: f.t("col.project"), nw: true }, { k: "times", t: f.t("col.times"), num: true }, { k: "people", t: f.t("col.people"), num: true },
    { k: "avg", t: f.t("col.avg_mark"), s: f.t("abbr.avg_mark"), num: true, f: (r) => (r.avg !== null ? f.num(r.avg, 1) : noMark(f, r.last_e)) },
    { k: "fails", t: f.t("col.fails"), s: f.t("abbr.fails"), num: true, hide: true },
    { k: "outstanding", t: f.t("col.outstanding"), s: f.t("abbr.outstanding"), num: true, hide: true },
    { k: "first", t: f.t("col.first"), nw: true, hide: true }, { k: "last", t: f.t("col.last"), nw: true },
  ], rows, { label: f.t("depth.given_title"), sort: ["times", -1], detail, empty: f.t(q ? "empty.search_depth" : "empty.period") });
}

function logSection(pg: Page): Section {
  const f = pg.f, D = pg.D;
  const role = pg.q("log", "received", ["received", "given"]);
  const flag = pg.q("flag", "", ["", "out", "bad", "ok"]);
  const projectsAll = [...new Set([...D.received, ...D.given].map((e: any) => e.project as string))].sort();
  const proj = pg.q("project", "", ["", ...projectsAll]);
  const q = pg.q("q", "").slice(0, 80).toLowerCase();
  const attemptOf = new Map<unknown, number>(D.projects.flatMap((p: any) => p.attempts.map((a: any) => [a.team_id, a.n] as [unknown, number])));
  const match = (e: any) => {
    if (flag && !(flag === "out" ? e.outstanding : flag === "bad" ? e.negative_flag : !e.outstanding && !e.negative_flag)) return false;
    if (proj && e.project !== proj) return false;
    const hay = JSON.stringify([e.corrector?.login, (e.correcteds || []).map((c: any) => c.login), e.comment, e.feedback, e.feedbacks, e.my_host, e.other_host, e.project, e.begin]).toLowerCase();
    return !q || hay.includes(q);
  };
  const rows = D[role].filter(match);
  const fbText = (e: any) => {
    if (!e.comment && !e.feedbacks?.length) return "";
    const parts = e.comment ? [`<div class="txt"><b>${esc(f.t("log.corrector_comment"))}</b>\n${esc(e.comment)}</div>`] : [];
    for (const x of e.feedbacks) {
      const kinds = KINDS.filter((k) => x[k] !== null && x[k] !== undefined).map((k) => `${f.t(`criterion.${k}`)} ${x[k]}/4`).join(" · ");
      parts.push(`<div class="txt"><b>${esc(f.t("log.feedback_by", { login: x.by || "?", rating: x.rating ?? "–" }))}</b>`
        + (kinds ? ` <span class="note">${esc(kinds)} · ${esc(x.at || "")}</span>` : "") + `\n${esc(x.comment || "")}</div>`);
    }
    const n = e.feedbacks.length;
    const what = e.comment && n ? f.t("log.comment_and_feedback", { count: n, n }) : e.comment ? f.t("log.comment_only") : f.t("log.feedback_only", { count: n, n });
    const text = String(e.comment || (n ? e.feedbacks[0].comment : "") || "").trim();
    const first = text.split("\n")[0].replace(/\s+/g, " ");
    const preview = first.slice(0, 140) + (first.length > 140 || text.includes("\n") ? "…" : "");
    return `<details><summary>${esc(what)}<span class="preview">${esc(preview)}</span></summary>${parts.join("")}</details>`;
  };
  const person = (p: any, checked: boolean) => {
    const seat = checked ? (p.host ? f.t("log.at_seat", { seat: p.host }) : f.t("log.not_logged")) : "";
    return `${avatar(p)}${esc(p.login)}` + (seat ? `<span class="sub">${esc(seat)}</span>` : "");
  };
  const when = { k: "begin_ms", t: f.t("col.when"), cls: "when", f: (e: any) => `<span class="nw">${esc(e.begin.slice(0, 10))}</span> <span class="nw">${esc(e.begin.slice(11))}`
    + (e.filled ? ` ${ARROW} ${esc(e.filled.slice(11))}` : "") + "</span>" };
  const flagCol = { k: "flag", t: f.t("col.flag"), nw: true, sv: (e: any) => (e.outstanding ? 2 : e.negative_flag ? 0 : 1), f: (e: any) => flagBadge(f, e) };
  const minCol = { k: "duration_min", t: f.t("col.duration"), s: f.t("abbr.duration"), num: true, nw: true,
    f: (e: any) => `${esc(f.t("unit.min", { n: f.num(e.duration_min) }))}<span class="sub">${esc([f.t("log.planned", { n: e.planned_min }),
      e.lead_h !== null && e.lead_h !== undefined ? f.t("log.booked_ahead", { h: f.num(e.lead_h, 1) }) : ""].filter(Boolean).join(" · "))}</span>` };
  const mySeat = { k: "my_host", t: f.t("col.your_seat"), nw: true, hide: true, f: (e: any) => esc(e.my_host || f.t("log.not_logged")) };
  const columns = role === "received" ? [when,
    { k: "project", t: f.t("col.project"), nw: true, f: (e: any) => `${esc(e.project)}<span class="sub">${esc(f.t("projects.attempt", { n: attemptOf.get(e.team_id) ?? "?" }))}</span>` },
    { k: "corrector", t: f.t("col.corrector"), s: f.t("abbr.corrector"), nw: true, sv: (e: any) => e.corrector.login, f: (e: any) => person(e.corrector, e.other_host_checked) },
    mySeat, minCol, { k: "mark", t: f.t("col.mark"), num: true }, flagCol, { k: "fb_rating", t: f.t("col.your_rating"), num: true, hide: true }]
    : [when, { k: "project", t: f.t("col.project"), nw: true },
      { k: "correcteds", t: f.t("col.evaluated"), s: f.t("abbr.evaluated"), nw: true, sv: (e: any) => e.correcteds.map((c: any) => c.login || "").join(","),
        f: (e: any) => e.correcteds.map((c: any) => person(c, e.other_host_checked)).join("<br>") },
      mySeat, minCol, { k: "mark", t: f.t("col.mark"), num: true, f: (e: any) => esc(e.mark ?? "") }, flagCol, { k: "fb_rating", t: f.t("col.their_rating"), num: true, hide: true }];
  const form = filters("log",
    radios("log", f.t("log.role_label"), (["received", "given"] as const).map((v) => [v, f.t(`log.${v}`)]), role)
    + select("flag", f.t("log.flag"), [["", f.t("log.flag_all")], ["out", f.t("log.flag_out")], ["bad", f.t("log.flag_bad")], ["ok", f.t("log.flag_ok")]], flag)
    + select("project", f.t("log.project"), [["", f.t("log.project_all")], ...projectsAll.map((p) => [p, p] as [string, string])], proj)
    + search("q", pg.q("q", "").slice(0, 80), f.t("common.search"), f.t("log.search_placeholder")));
  return { id: "log", nav: f.t("nav.log"), html: section("log", f.t("log.title"), form + `<div id="log-results"><p class="controls-after"><span class="note">${esc(f.plural(rows.length, "count.evaluations"))}</span></p>`
    + cols(block("table-log", `<div class="table-wrap tall">${table(f, columns as any, rows, { label: f.t("log.title"), sort: ["begin_ms", -1], empty: f.t("empty.search_log"), sticky: true, detail: fbText })}</div>`)) + "</div>",
  { lede: esc(f.t("log.lede")) }) };
}
