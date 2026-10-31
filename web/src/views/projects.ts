// Projects: your level and pace, skills, every project and attempt, exams, technical domains, the timeline and what
// 42 gave you for it (achievements, titles, quests, events).
import { BAD, GOOD, NEUTRAL, S1, S2, hbars, legend, lines, timeline, vbars, empty } from "../lib/charts";
import { radar } from "../lib/graphs";
import { ARROW, badge, esc } from "../lib/h";
import { pyRound } from "../fmt";
import { csv, facts, table } from "../lib/table";
import { Page, Section, block, cols, filters, headBlock, radios, search, section, select } from "./page";

const PROJECT_GROUPS = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06", "outer-core", "piscine"];

const groupLabel = (pg: Page, g: string) => (g === "piscine" ? pg.f.t("track.piscine") : pg.f.t(`groups.${g}`));

export function projectFilters(pg: Page) {
  const years = [...new Set(pg.allProjects.map((p) => (p.marked || p.registered || "").slice(0, 4)).filter(Boolean))].sort().reverse() as string[];
  return {
    track: pg.q("track", pg.period, ["student", "piscine", "all"]), search: pg.q("q", "").slice(0, 80),
    marks: pg.q("marks", "all", ["all", "bonus", "max", "failed"]), year: pg.q("year", "all", ["all", ...years]),
    grouped: pg.q("group") === "1", years,
  };
}

export function projectView(projects: any[], fl: ReturnType<typeof projectFilters>) {
  const q = fl.search.trim().toLowerCase();
  const markOk: Record<string, (p: any) => boolean> = {
    bonus: (p) => (p.mark || 0) > 100, max: (p) => p.mark === 125,
    failed: (p) => !p.validated && p.mark !== null && p.status === "finished",
  };
  return projects.filter((p) => !p.exam // exams have their own section
    && (fl.track === "all" || (p.track === "piscine") === (fl.track === "piscine"))
    && (!q || p.name.toLowerCase().includes(q)) && (markOk[fl.marks] || (() => true))(p)
    && (fl.year === "all" || (p.marked || p.registered || "").startsWith(fl.year)));
}

function markChip(pg: Page, a: any) {
  const f = pg.f;
  const state = a.validated === true ? "pass" : a.validated === false ? "fail" : a.mark === null ? "open" : "";
  const outcome = a.validated === true ? `, ${f.t("outcome.validated").toLowerCase()}` : a.validated === false ? `, ${f.t("outcome.failed").toLowerCase()}` : "";
  const title = [f.t("projects.attempt_title", { n: a.n }) + outcome, a.start, a.members?.length ? f.t("projects.with", { list: a.members.join(", ") }) : "",
    a.moulinette?.length ? f.t("projects.moulinette", { marks: a.moulinette.map((m: any) => m.mark).join(", ") }) : ""].filter(Boolean).join(" · ");
  return `<span class="mark ${state}" title="${esc(title)}">${esc(a.mark ?? f.t("projects.pending"))}</span>`;
}

/** The CSV downloads: the table as filtered, and the portfolio (validated projects, nobody else's data). */
export function projectsCsv(pg: Page): string {
  const f = pg.f, fl = projectFilters(pg);
  return csv([[f.t("col.project"), f.t("col.track"), f.t("col.group"), f.t("col.status"), f.t("col.final"), f.t("col.attempts"), f.t("col.outstanding"),
    f.t("col.xp"), f.t("col.started"), f.t("col.marked")],
  ...projectView(pg.allProjects, fl).map((p) => [p.name, f.t(`track.${p.track}`), groupLabel(pg, p.group || p.track), p.status, p.mark,
    p.attempts.length, p.outstanding, p.xp_earned, (p.registered || "").slice(0, 10), (p.marked || "").slice(0, 10)])]);
}

export function portfolioCsv(pg: Page): string {
  const f = pg.f;
  return csv([[f.t("col.project"), f.t("col.track"), f.t("col.areas"), f.t("col.started"), f.t("col.marked"), f.t("col.final"), f.t("col.attempts"),
    f.t("col.xp"), f.t("col.team"), f.t("col.days_to_validate")], ...(pg.v.derive?.portfolio || [])]);
}

const csvButtons = (pg: Page, kind: string, title: string, button: string) =>
  `<span class="head-actions"><button class="btn secondary" type="button" data-preview="${kind}" data-title="${esc(title)}" aria-haspopup="dialog">${esc(pg.f.t("common.preview"))}</button>`
  + `<button class="btn secondary" type="button" data-download="${kind}">${esc(button)}</button></span>`;

/** The level an achievement's description names ("Attended 21 events." → 21, "1.000 points" → 1000); 0 when none. */
const achLevel = (a: any) => +((/\d{1,3}(?:[.,]\d{3})+|\d+/.exec(a.description || "") || ["0"])[0].replace(/[.,]/g, ""));

/** Achievements of one series (same name) as one entry: the highest level on top, the others below it, highest
 * first; series ordered by when their top level was earned, newest first. */
export function achievementSeries(list: any[]): { top: any; rest: any[] }[] {
  const by = new Map<string, any[]>();
  for (const a of list) by.set(a.name, [...(by.get(a.name) || []), a]);
  return [...by.values()].map((xs) => xs.sort((a, b) => achLevel(b) - achLevel(a) || String(b.at || "").localeCompare(String(a.at || ""))))
    .map(([top, ...rest]) => ({ top, rest })).sort((a, b) => String(b.top.at || "").localeCompare(String(a.top.at || "")));
}

export function projects(pg: Page): Section[] {
  const f = pg.f, D = pg.D, X = D.extras, dv = pg.v.derive || {};
  const out: Section[] = [];

  // level, pace and the alumni estimate (Home held them in v1)
  const main = (X.cursus || []).find((c: any) => c.name === "42cursus");
  const pc = D.insights?.pace;
  const due = dv.alumni_due;
  const lvl: [string, string][] = [];
  if (main) lvl.push([f.t("home.k_level"), f.level(main.level)]);
  if (pc) {
    if (pc.months_since_kickoff !== null && pc.months_since_kickoff !== undefined) lvl.push([f.t("pace.since"), esc(f.plural(pc.months_since_kickoff, "pace.months"))]);
    lvl.push([f.t("pace.xp_month"), f.num(pc.xp_per_month)]);
    lvl.push([f.t("pace.validated"), f.num(pc.months.reduce((s: number, m: any) => s + m.validated, 0))]);
    if (pc.blackhole_days !== null && pc.blackhole_days !== undefined) lvl.push([f.t("pace.blackhole"), esc(f.plural(pc.blackhole_days, "count.days"))]);
  }
  if (due) lvl.push([f.t("profile.alumni"), due === "paused" ? esc(f.t("profile.paused")) : esc(f.day(due))]);
  const months = pc?.months || [], promo = pg.v.promo;
  out.push({ id: "pace", nav: f.t("nav.pace"), html: section("pace", f.t("pace.title"), `<dl class="facts">${facts(lvl)}</dl>` + cols(headBlock("pace-xp", f.t("pace.xp_title"),
    legend([[f.t("pace.xp"), S1], [f.t("pace.cumulative"), S2]]), vbars(f, months.map((m: any) => f.monthLabel(m.month)), [[f.t("pace.xp"), months.map((m: any) => m.xp), S1]],
      { label: f.t("pace.xp_title"), line: [f.t("pace.cumulative"), months.map((m: any) => m.cumulative), S2], fmt: (v) => f.num(v), emptyText: f.t("empty.period") })),
    promo ? block("promo", promoChart(pg, promo), f.t("standing.promo"), f.t("standing.promo_lede", { rank: f.num(promo.rank), size: f.num(promo.size), pct: f.num(promo.percentile, 1) })) : "")) });

  const cursus = pg.q("cursus", pg.period === "piscine" ? "C Piscine" : "42cursus", ["42cursus", "C Piscine"]);
  const items = X.skills_by_cursus?.[cursus] || (cursus === "42cursus" ? X.skills || [] : []);
  let skills = empty(f.t("empty.period"));
  if (items.length) {
    const graded = items.filter((s: any) => s.level > 0);
    const bars = hbars(f, graded.map((s: any) => s.name), [[f.t("extras.level"), graded.map((s: any) => s.level), S1]],
      { label: f.t("extras.skills_title"), end: (_i, v) => f.level(v), big: true });
    skills = `<div class="radar-pair"><div class="radar-fig">${radar(f, items, f.t("extras.skills_title"))}</div><div class="radar-bars">${bars}</div></div>`;
  }
  const sw = pg.seg("cursus", [["42cursus", f.t("track.student")], ["C Piscine", f.t("track.piscine")]], cursus, f.t("skills.cursus"), "skills");
  out.push({ id: "skills", nav: f.t("extras.skills_title"), html: section("skills", "", cols(block("skills", skills)),
    { head: `<div class="panel-head"><h2>${esc(f.t("extras.skills_title"))}</h2>${sw}</div>` }) });

  // every project with each attempt
  const fl = projectFilters(pg);
  const rows = projectView(pg.allProjects, fl);
  const evalLine = (e: any) => {
    const state = e.mark === null ? "open" : e.negative || e.mark < 50 ? "fail" : "pass";
    const flag = e.outstanding ? " " + badge(f.t("flag.outstanding"), "out") : e.negative ? " " + badge(e.flag || "", "bad") : "";
    return `<li><span class="code">${esc(e.corrector)}</span> <span class="mark ${state}">${esc(e.mark ?? "–")}</span>${flag} <span class="note">${esc(e.begin ? f.dayTime(e.begin) : "")}</span></li>`;
  };
  const detail = (p: any) => {
    if (!p.attempts.length) return "";
    const lis = p.attempts.map((a: any) => `<li><p><b>${esc(f.t("projects.attempt_title", { n: a.n }))}</b> ${markChip(pg, a)} <span class="note">${esc(f.dayTime(a.start))} ${ARROW} `
      + `${esc(a.closed || a.locked ? f.dayTime(a.closed || a.locked) : f.t("projects.tip_open"))}</span></p><p class="note">${esc(a.members?.length ? f.t("projects_table.team", { list: a.members.join(", ") }) : f.t("projects_table.solo"))}</p>`
      + (a.evaluations?.length ? `<ul class="evals">${a.evaluations.map(evalLine).join("")}</ul>` : `<p class="note">${esc(f.t("projects_table.no_evals"))}</p>`) + "</li>").join("");
    const n = p.attempts.length;
    return `<details><summary>${esc(f.t("projects_table.detail", { count: n, n }))}</summary><ol class="attempts">${lis}</ol></details>`;
  };
  const status = (p: any) => { const s = p.status || ""; return esc(f.has(`status.${s}`) ? f.t(`status.${s}`) : s.replace(/_/g, " ")); };
  const tbl = table(f, [
    { k: "name", t: f.t("col.project"), cls: "proj" },
    { k: "track", t: f.t("col.track"), nw: true, hide: true, f: (p) => badge(f.t(`track.${p.track}`)) },
    { k: "status", t: f.t("col.status"), nw: true, hide: true, f: status },
    { k: "mark", t: f.t("col.final"), num: true, f: (p) => (p.mark !== null && p.mark !== undefined ? esc(p.mark) : "–") },
    { k: "attempts", t: f.t("col.attempts"), s: f.t("abbr.attempts"), cls: "marks-col", sv: (p) => p.attempts.length,
      f: (p) => '<span class="marks">' + p.attempts.map((a: any, i: number) => (i === 0 ? markChip(pg, a) : `<span class="step">${ARROW}${markChip(pg, a)}</span>`)).join("") + "</span>" },
    { k: "outstanding", t: f.t("col.outstanding"), s: f.t("abbr.outstanding"), num: true },
    { k: "xp_earned", t: f.t("col.xp"), num: true, nw: true, f: (p) => `${f.num(p.xp_earned)}<span class="sub">${esc(f.t("projects_table.xp_base", { xp: f.num(p.xp_base) }))}</span>` },
    { k: "first_ms", t: f.t("col.started"), nw: true, hide: true, f: (p) => esc(f.day(p.registered)) },
  ], rows, { label: f.t("projects_table.title"), sort: ["first_ms", -1], sticky: true, detail, empty: f.t("projects_table.none"),
    group: fl.grouped ? { key: (p) => p.group || p.track, order: PROJECT_GROUPS, label: (g) => groupLabel(pg, g) } : undefined });
  const form = filters("projects-table",
    radios("track", f.t("projects_table.filter"), (["student", "piscine", "all"] as const).map((v) => [v, f.t(`track.${v}`)]), fl.track)
    + search("q", fl.search, f.t("common.search"), f.t("projects_table.search"))
    + select("marks", f.t("projects_table.marks"), ["all", "bonus", "max", "failed"].map((v) => [v, f.t(`projects_table.marks_${v}`)]), fl.marks)
    + select("year", f.t("projects_table.year"), [["all", f.t("projects_table.year_all")], ...fl.years.map((y) => [y, y] as [string, string])], fl.year)
    + `<label class="toggle-check"><input type="checkbox" name="group" value="1"${fl.grouped ? " checked" : ""}><span>${esc(f.t("projects_table.group"))}</span></label>`);
  out.push({ id: "projects-table", nav: f.t("nav.projects_table"), html: section("projects-table", f.t("projects_table.title"),
    form + `<div id="projects-table-results">` + cols(`<div class="block" data-panel="projects-table"><div class="table-wrap tall">${tbl}</div>`
      + `<div class="table-foot"><p class="note"><b>${esc(f.plural(rows.length, "projects_table.count"))}</b> · ${esc(f.t("projects_table.xp_note"))}</p>`
      + csvButtons(pg, "projects", f.t("projects_table.title"), f.t("projects_table.csv")) + "</div></div>") + "</div>",
    ) });

  const exams = D.insights?.exams || [];
  out.push({ id: "exams", nav: f.t("nav.exams"), html: section("exams", f.t("exams.title"), cols(block("exams", `<div class="table-wrap">${table(f, [
    { k: "name", t: f.t("col.exam"), nw: true },
    { k: "passed", t: f.t("col.status"), nw: true, sv: (e) => (e.passed ? 1 : 0), f: (e) => badge(f.t(e.passed ? "exams.passed" : "exams.pending"), e.passed ? "out" : "") },
    { k: "attempts", t: f.t("col.attempts"), s: f.t("abbr.attempts"), num: true }, { k: "best", t: f.t("col.best"), num: true },
    { k: "days_to_pass", t: f.t("col.days_to_pass"), s: f.t("abbr.days_to_pass"), num: true, f: (e) => esc(f.num(e.days_to_pass)) },
    { k: "tries", t: f.t("col.tries"), ph: true, sv: (e) => e.tries.length, f: (e) => '<span class="marks">' + e.tries.map((x: any) =>
      `<span class="mark ${x.passed ? "pass" : "fail"}" title="${esc(f.day(x.date))}">${esc(x.mark ?? "–")}</span>`).join("") + "</span>" },
  ], exams, { label: f.t("exams.title"), sort: ["name", 1], empty: f.t("exams.none") })}</div>`))) });

  const areas = dv.domains || [];
  const cap = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);
  out.push({ id: "domains", nav: f.t("domains.title"), html: section("domains", "", `<p class="note lede-note">${esc(f.t("domains.xp_note"))}</p>`
    + cols(block("domains", hbars(f, areas.map((a: any) => cap(f.t(`domains.tag.${a.key}`))), [[f.t("col.xp"), areas.map((a: any) => a.xp), S1]], {
      label: f.t("domains.title"), tips: areas.map((a: any) => `${f.t(`domains.tag.${a.key}`)} · ≈ ${f.num(a.xp)} XP · ${a.projects.join(", ")}`),
      end: (_i, v) => `≈ ${f.num(v)}`, extra: (i) => f.plural(areas[i].projects.length, "domains.projects"), emptyText: f.t("domains.none"), big: true }))),
  { head: `<div class="panel-head"><h2>${esc(f.t("domains.title"))}</h2>${csvButtons(pg, "portfolio", f.t("domains.portfolio_title"), f.t("domains.portfolio"))}</div>` }) });

  const tl = D.projects.map((p: any) => [p.name, p.attempts.map((a: any) => {
    const c = a.validated === true ? GOOD : a.validated === false ? BAD : NEUTRAL;
    const outcome = a.validated ? f.t("outcome.validated") : a.validated === false ? f.t("outcome.failed") : a.status ? (f.has(`status.${a.status}`) ? f.t(`status.${a.status}`) : a.status.replace(/_/g, " ")) : "";
    const tip = [f.t("projects.tip_title", { name: p.name, n: a.n, of: p.attempts.length }), `${outcome} · ${f.t("projects.tip_mark", { mark: a.mark ?? "–" })}`,
      `${a.start} ➜ ${a.closed || a.locked || f.t("projects.tip_open")} (${f.t("projects.tip_days", { count: pyRound(a.days, 1), n: f.num(a.days, 1) })})`,
      f.plural((a.evals || []).length, "count.evaluations") + (a.outstanding ? ` · ${a.outstanding} ${f.t("flag.outstanding")}` : ""),
      a.correctors?.length ? f.t("projects.by", { list: a.correctors.join(", ") }) : "", a.members?.length ? f.t("projects.team", { list: a.members.join(", ") }) : ""].filter(Boolean).join(" · ");
    return [a.start_ms, a.end_ms || a.start_ms, c, tip];
  })]) as [string, [number, number, string, string][]][];
  const retries = D.projects.flatMap((p: any) => p.attempts.slice(1).map((a: any) => a.start_ms)).sort((a: number, b: number) => a - b).map((x: number, i: number) => ({ x, y: i + 1 }));
  const validated = D.projects.map((p: any) => p.attempts.find((a: any) => a.validated && a.end_ms)?.end_ms).filter(Boolean)
    .sort((a: number, b: number) => a - b).map((x: number, i: number) => ({ x, y: i + 1 }));
  out.push({ id: "timeline", nav: f.t("nav.projects"), html: section("timeline", f.t("projects.title"), cols(
    `<div class="block" data-panel="timeline"><div class="block-head"><h3>${esc(f.t("projects.timeline_title"))}</h3>${legend([[f.t("outcome.validated"), GOOD], [f.t("outcome.failed"), BAD], [f.t("outcome.in_progress"), NEUTRAL]])}</div>`
    + timeline(f, tl, { label: f.t("projects.timeline_aria"), emptyText: f.t("empty.period") }) + "</div>",
    block("cum-retries", lines(f, [[f.t("col.retries"), retries, S1]], { label: f.t("projects.cum_title"), emptyText: f.t("empty.period") }), f.t("projects.cum_title"), f.t("projects.cum_note")),
    block("cum-validated", lines(f, [[f.t("outcome.validated"), validated, GOOD]], { label: f.t("projects.validated_title"), emptyText: f.t("empty.period") }), f.t("projects.validated_title"), f.t("projects.validated_note"))),
  ) });

  // what 42 gave you along the way
  const none = `<li class="note">${esc(f.t("empty.period"))}</li>`;
  const evKind = (k: string) => (f.has(`event.${k}`) ? f.t(`event.${k}`) : String(k).replace(/_/g, " "));
  const tier = (a: any) => (a.tier && a.tier !== "none" ? " " + badge(f.has(`tier.${a.tier}`) ? f.t(`tier.${a.tier}`) : a.tier) : "");
  const ach = achievementSeries(X.achievements).map(({ top, rest }) => `<li><span><b>${esc(top.name)}</b>${tier(top)}<br>`
    + `<span class="note">${esc(top.description || "")}</span></span><span class="when">${esc(f.day(top.at))}</span>`
    + (rest.length ? `<details class="ach-more"><summary>${esc(f.plural(rest.length, "extras.ach_more"))}</summary><ul>${rest.map((a) =>
      `<li><span class="note">${esc(a.description || "")}${tier(a)}</span><span class="when">${esc(f.day(a.at))}</span></li>`).join("")}</ul></details>` : "") + "</li>").join("");
  const evs = [...X.events].reverse().map((e: any) => `<li><span>${esc(e.name)}<br><span class="note">${esc(evKind(e.kind))}${e.location ? " · " + esc(e.location) : ""}`
    + `${e.hours ? ` · ${esc(f.num(e.hours, 1))} h` : ""}</span></span><span class="when">${esc(f.day(e.begin))}</span></li>`).join("");
  const misc = [...X.titles.map((x: any) => `<li><span><b>${esc(f.t("extras.title_item"))}</b> ${esc(x.name)}${x.selected ? " " + badge(f.t("extras.selected")) : ""}</span><span class="when">${esc(f.day(x.at))}</span></li>`),
    ...X.expertises.map((x: any) => `<li><span><b>${esc(f.t("extras.expertise"))}</b> ${esc(x.name)}</span><span class="when">${esc(x.value)} / 5</span></li>`),
    ...X.quests.map((q: any) => `<li><span><b>${esc(f.t("extras.quest"))}</b> ${esc(q.name)}<br><span class="note">${esc(q.description || "")}</span></span><span class="when">${esc(q.validated ? f.day(q.validated) : f.t("extras.in_progress"))}</span></li>`)].join("");
  const kinds = Object.entries(X.event_kinds || {}).map(([k, v]) => `${evKind(k)}: ${v}`).join(" · ");
  out.push({ id: "activity", nav: f.t("activity.title"), html: section("activity", f.t("activity.title"), cols(
    block("achievements", `<ul class="list">${ach || none}</ul>`, f.t("extras.achievements_title")),
    `<div class="block" data-panel="events"><h3>${esc(f.t("extras.events_title"))}</h3><p class="note">${esc(kinds)}</p><ul class="list">${evs || none}</ul></div>`,
    block("misc", `<ul class="list">${misc || none}</ul>`, f.t("extras.misc_title")))) });
  return out;
}

/** Your promo by level, your level's bar in the accent. */
function promoChart(pg: Page, promo: any) {
  const f = pg.f;
  const hist = new Map<number, number>(promo.histogram.map((h: any) => [h.level, h.count]));
  const keys = [...hist.keys()];
  const levels = keys.length ? Array.from({ length: Math.max(...keys) - Math.min(...keys) + 1 }, (_, i) => Math.min(...keys) + i) : [];
  const mine = Math.floor(promo.mine);
  const tips = levels.map((lv) => [f.t("standing.level_tip", { level: lv }), f.plural(hist.get(lv) || 0, "standing.n_students"), ...(lv === mine ? [f.t("standing.you_here")] : [])].join(" · "));
  return vbars(f, levels.map(String), [[f.t("standing.students"), levels.map((lv) => (lv !== mine ? hist.get(lv) || 0 : 0)), S2],
    [f.t("standing.your_level"), levels.map((lv) => (lv === mine ? hist.get(lv) || 0 : 0)), S1]],
  { label: f.t("standing.promo"), stacked: true, xtitle: f.t("standing.level_axis"), fmt: (v) => f.num(v), tips });
}
