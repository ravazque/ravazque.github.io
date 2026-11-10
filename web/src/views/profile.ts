// Profile (the home page): who you are, three figures of your history, the path so far, and the sections of other pages
// kept as widgets (in this browser; Contribution, Rhythm and the bonus to begin with; Activity is one of them).
import { badge, esc, initials } from "../lib/h";
import { Page, type PageKey, type Section, block, cols, info, myRank, myTrack, section } from "./page";
import { projects } from "./projects";
import { evaluations } from "./evaluations";
import { coalition } from "./coalition";
import { people } from "./people";
import { campus } from "./campus";

const num = (f: Page["f"], v: number, d = 0, unit = "") =>
  `<span data-count="${v}" data-dec="${d}">${esc(f.num(v, d))}</span>${unit ? `<small>${esc(unit)}</small>` : ""}`;
/** Hours as a big figure: hours and minutes ("1,131:24 h"), counting up the same way. */
const hoursFigure = (f: Page["f"], h: number) => `<span data-count="${h}" data-hm="1">${esc(f.hmm(h))}</span><small> h</small>`;

/** Who this is: the photo in a soft frame; "name | login"; the title chosen on the intra (or the login) and the campus; the
 * coalition, group, grade, track and groups; four figures between rules; and the path so far on a timeline. */
function card(pg: Page): string {
  const f = pg.f, D = pg.D, P = D.profile;
  const cursus = new Map<string, any>((pg.v.all_cursus || D.extras.cursus || []).map((c: any) => [c.name, c]));
  const main = cursus.get("42cursus");
  const coal = P.coalition, promo = pg.v.promo, rank = myRank(D.extras), track = myTrack(D.extras);
  const has = (v: any) => v !== null && v !== undefined;
  const title = (D.extras.titles || []).find((t: any) => t.selected)?.name;
  const who = esc(title || P.login) + (P.campus_current ? ` · ${esc(P.campus_current)}` : "");
  // beside your name, where you are: Student, OuterCore or Alumni; under it everything else as tags: the coalition (its
  // name alone), the milestone you are on, grade, track and your groups (Mentor…)
  const status = rank === "alumni" ? "st_alumni" : rank === "outer-core" ? "st_outer" : rank ? "st_student" : "";
  const tags = [coal ? badge(coal.name) : "", rank?.startsWith("rank-") ? badge(f.t(`groups.${rank}`)) : rank ? "" : badge(f.t("home.no_cursus")),
    main?.grade ? badge(main.grade) : "", track ? badge(f.t(`profile.track_${track}`)) : "", ...(P.groups || []).map((g: string) => badge(g))].join("");
  // the four figures, drawn like the three modules under the card (larger: spacing.css, --card-module-*) and counting up
  // like them, each with a line (already escaped): your place by level in Madrid (live, the server reads it every hour;
  // until it has, the way to the next level), in your kickoff, the wallet (the API keeps no history of it: staff only),
  // and the correction points earned and spent in the period, with what the balance holds from the other one
  const CP = D.correction_points, M = pg.v.madrid, hundredths = main ? Math.round(main.level * 100) : 0;
  const level = !main ? "" : M ? esc(M.top <= 50 ? f.t("profile.madrid_top", { pct: f.num(M.top, 1) })
    : f.t("profile.madrid_above", { pct: f.num((100 * (M.size - M.rank)) / M.size, 1) }))
    : esc(f.t("profile.level_next", { pct: hundredths % 100, next: Math.floor(hundredths / 100) + 1 }));
  // what the balance holds from outside the period (the Piscine's, seen from the student period) goes into earned or
  // spent, so that the line adds up to the figure (the historics' sums do; their running totals don't)
  const carried = CP && has(P.correction_point) ? P.correction_point - (CP.earned || 0) + (CP.spent || 0) : 0;
  const points = !CP ? "" : esc(f.t("profile.points_line", { earned: f.num((CP.earned || 0) + Math.max(carried, 0)), spent: f.num((CP.spent || 0) + Math.max(-carried, 0)) }));
  const figures = `<div class="modules pf-modules">` + ([
    ["level", main && M ? `<span class="tab-t">${esc(f.t("home.k_level"))}${info(f.t("profile.madrid_tip", { n: f.num(M.size) }))}</span>` : esc(f.t("home.k_level")),
      main?.grade || "42cursus", main ? num(f, main.level, 2) : "–", level],
    ["promo", esc(f.t("standing.promo")), P.campus_current || "", promo ? `#${num(f, promo.rank)}<small> / ${esc(f.num(promo.size))}</small>` : "–",
      promo ? esc(f.t("profile.promo_line", { pct: f.num(promo.percentile, 1) })) : ""],
    ["wallet", esc(f.t("head.wallet")), "", has(P.wallet) ? num(f, P.wallet, 0, " ₳") : "–", has(P.wallet) ? esc(f.t("profile.wallet_line")) : ""],
    ["points", esc(f.t("head.points")), "", has(P.correction_point) ? num(f, P.correction_point) : "–", points]] as [string, string, string, string, string][])
    .map(([k, t, aside, v, line]) => `<article class="module" data-module="${k}"><h3 class="tab">${t}${aside ? `<span>${esc(aside)}</span>` : ""}</h3><p class="figure">${v}</p>`
      + (line ? `<p class="line">${line}</p>` : "") + "</article>").join("") + "</div>";
  return `<section id="profile" class="pf" aria-label="${esc(f.t("profile.title"))}">`
    + `<div class="pf-head"><div class="avatar-lg pf-photo"><span aria-hidden="true">${esc(initials(P.name || P.login))}</span>${P.image ? `<img src="${esc(P.image)}" alt="">` : ""}</div>`
    + `<div class="pf-id"><p class="pf-name">${esc(P.name || P.login)}${status ? `<span class="pf-status">${esc(f.t(`profile.${status}`))}</span>` : ""}</p>`
    + `<p class="pf-sub"><span>${who}</span></p><p class="pf-sub pf-tags">${tags}</p></div></div>`
    + figures
    + "</section>";
}

/** The path so far, one stop per moment by date: the Piscine, the 42cursus start, every campus moved to (and back home
 * from), Transcender (the Common Core Rank 06 quest validated), alumni, today and the estimated alumni date; solid up to
 * today, dashed after, each stretch in its colour (Piscine, Common Core, OuterCore). */
function path(pg: Page): string {
  const f = pg.f, D = pg.D, P = D.profile, dv = pg.v.derive || {};
  const cursus = new Map<string, any>((pg.v.all_cursus || D.extras.cursus || []).map((c: any) => [c.name, c]));
  const main = cursus.get("42cursus"), piscine = cursus.get("C Piscine");
  const ms = (s: string) => Date.parse(String(s).slice(0, 10));
  const month = (s: string) => `${f.months[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
  const today = pg.asOf ? ms(pg.asOf) : Date.now();
  const stops: { k: string; d: string; t: number; cls: string; tip?: string }[] = [];
  if (piscine?.begin) stops.push({ k: f.t("profile.piscine"), d: month(piscine.begin), t: ms(piscine.begin), cls: "" });
  if (main?.begin) stops.push({ k: f.t("profile.kickoff"), d: f.day(main.begin), t: ms(main.begin), cls: "" });
  // campuses by the day you joined them: one you moved to (your main one now), one you joined for a while and, when
  // your main campus has sessions after your last one there, the day you were back
  const camps = [...(D.campuses || [])].filter((c: any) => c.joined).sort((a: any, b: any) => String(a.joined).localeCompare(String(b.joined)));
  const home = camps.find((c: any) => c.primary);
  camps.slice(1).forEach((c: any) => {
    if (c.primary) { stops.push({ k: f.t("profile.moved", { campus: c.name }), d: f.day(c.joined), t: ms(c.joined), cls: "move" }); return; }
    stops.push({ k: f.t("profile.joined_campus", { campus: c.name }), d: f.day(c.joined), t: ms(c.joined), cls: "move" });
    if (home && c.last && home.last && home.joined <= c.joined && home.last > c.last)
      stops.push({ k: f.t("profile.back", { campus: home.name }), d: f.day(c.last), t: ms(c.last), cls: "move" });
  });
  const q6 = (D.extras.quests || []).find((q: any) => /rank 06/i.test(q.name || "") && q.validated);
  const transcend = q6 ? ms(q6.validated) : NaN, alumnized = P.alumnized ? ms(P.alumnized) : NaN;
  if (q6) stops.push({ k: f.t("profile.transcender"), d: f.day(q6.validated), t: transcend, cls: "key" });
  if (P.alumnized) stops.push({ k: f.t("profile.alumnized"), d: f.day(P.alumnized), t: alumnized, cls: "key" });
  const paused = dv.alumni_due === "paused";
  stops.push({ k: f.t("profile.today"), d: f.day(new Date(today).toISOString()) + (paused ? ` · ${f.t("profile.paused_short")}` : ""), t: today, cls: "now",
    tip: paused ? f.t("profile.paused") : undefined });
  if (dv.alumni_due && !paused && !P.alumnized) stops.push({ k: f.t("profile.alumni"), d: f.day(dv.alumni_due), t: ms(dv.alumni_due), cls: ms(dv.alumni_due) > today ? "future" : "" });
  const shown = stops.filter((s) => Number.isFinite(s.t)).sort((a, b) => a.t - b.t);
  if (shown.length < 2) return "";
  const lo = shown[0].t, hi = shown[shown.length - 1].t;
  const at = (t: number) => (hi > lo ? (100 * (t - lo)) / (hi - lo) : 0), pc = (t: number) => at(t).toFixed(1);
  const kick = main?.begin ? ms(main.begin) : NaN, pis = piscine?.begin ? ms(piscine.begin) : NaN;
  const phases = ([["pisc", pis, kick], ["cc", kick, Number.isFinite(transcend) ? transcend : Math.min(today, hi)],
    ["oc", transcend, Number.isFinite(alumnized) ? alumnized : Math.min(today, hi)]] as [string, number, number][])
    .filter(([, a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a);
  return `<div class="pf-box"><div class="pf-time" role="img" aria-label="${esc(shown.map((s) => `${s.k} ${s.d}`).join(" · "))}"><div class="pf-line" aria-hidden="true">`
    + `<span class="done" style="width:${pc(today)}%"></span><span class="ahead" style="left:${pc(today)}%"></span>`
    + phases.map(([c, a, b]) => `<span class="phase ${c}" style="left:${pc(a)}%;width:${(at(b) - at(a)).toFixed(1)}%"></span>`).join("")
    + shown.map((s) => `<i class="${s.cls}" style="left:${pc(s.t)}%"></i>`).join("") + "</div>"
    + shown.map((s, i) => `<span class="pf-mark ${i % 2 ? "down" : "up"}${at(s.t) > 75 ? " right" : at(s.t) < 25 ? " left" : ""}${s.cls ? ` ${s.cls}` : ""}" aria-hidden="true"`
      + ` style="left:${pc(s.t)}%;--d:${(at(s.t) / 100).toFixed(2)}"${s.tip ? ` data-tip="${esc(s.tip)}" title="${esc(s.tip)}"` : ""}><b>${esc(s.k)}</b>${esc(s.d)}</span>`).join("") + "</div></div>";
}

/** Three figures of your history: projects, evaluations and logged time, with what they hold (no charts: the pages have them). */
function modules(pg: Page): string {
  const f = pg.f, D = pg.D, S = D.summary, L = D.logtime;
  const mods: { key: string; label: string; aside?: string; value: string; lines: string[] }[] = [
    { key: "projects", label: f.t("home.k_projects"), aside: f.t("home.validated"), value: num(f, S.validated, 0, ` / ${f.num(S.projects)}`),
      lines: [f.t("home.attempts", { attempts: S.attempts, retries: S.retries })] },
    { key: "evals", label: f.t("home.k_evals"), aside: f.t("home.received_given"), value: num(f, S.received, 0, ` · ${f.num(S.given)}`),
      lines: [f.t("home.out", { received: S.received_outstanding, given: S.given_outstanding })] },
    { key: "hours", label: f.t("home.k_hours"), aside: f.t(`period.${pg.period}`), value: hoursFigure(f, L.total_seconds / 3600),
      lines: [f.t("home.days", { days: f.plural(L.days_present, "count.days") })] },
  ];
  return `<section id="home-kpis" class="modules-wrap"><h2 class="visually-hidden">${esc(f.t("home.title"))}</h2><div class="modules">`
    + mods.map((x) => `<article class="module" data-module="${x.key}"><h3 class="tab">${esc(x.label)}${x.aside ? `<span>${esc(x.aside)}</span>` : ""}</h3>`
      + `<p class="figure">${x.value}</p>`
      + x.lines.filter(Boolean).map((l) => `<p class="line">${esc(l)}</p>`).join("") + "</article>").join("") + "</div></section>";
}

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

/** What 42 gave you along the way (achievements, events, titles, expertises and quests) and the campuses you have been
 * to: a widget of Profile (taken away to begin with). */
export function activity(pg: Page): Section[] {
  const f = pg.f, D = pg.D, X = D.extras;
  const none = `<li class="note">${esc(f.t("empty.period"))}</li>`;
  const evKind = (k: string) => (f.has(`event.${k}`) ? f.t(`event.${k}`) : String(k).replace(/_/g, " "));
  const tier = (a: any) => (a.tier && a.tier !== "none" ? " " + badge(f.has(`tier.${a.tier}`) ? f.t(`tier.${a.tier}`) : a.tier) : "");
  const ach = achievementSeries(X.achievements).map(({ top, rest }) => `<li><span><b>${esc(top.name)}</b>${tier(top)}<br>`
    + `<span class="note">${esc(top.description || "")}</span></span><span class="when">${esc(f.day(top.at))}</span>`
    + (rest.length ? `<details class="ach-more"><summary>${esc(f.plural(rest.length, "extras.ach_more"))}</summary><ul>${rest.map((a) =>
      `<li><span class="note">${esc(a.description || "")}${tier(a)}</span><span class="when">${esc(f.day(a.at))}</span></li>`).join("")}</ul></details>` : "") + "</li>").join("");
  const evs = [...X.events].reverse().map((e: any) => `<li><span>${esc(e.name)}<br><span class="note">${esc(evKind(e.kind))}${e.location ? " · " + esc(e.location) : ""}`
    + `${e.hours ? ` · ${esc(f.nb(e.hours, "h"))}` : ""}</span></span><span class="when">${esc(f.day(e.begin))}</span></li>`).join("");
  const misc = [...X.titles.map((x: any) => `<li><span><b>${esc(f.t("extras.title_item"))}</b> ${esc(x.name)}</span><span class="when">${esc(f.day(x.at))}</span></li>`),
    ...X.expertises.map((x: any) => `<li><span><b>${esc(f.t("extras.expertise"))}</b> ${esc(x.name)}</span><span class="when">${esc(x.value)} / 5</span></li>`),
    ...X.quests.map((q: any) => `<li><span><b>${esc(f.t("extras.quest"))}</b> ${esc(q.name)}<br><span class="note">${esc(q.description || "")}</span></span><span class="when">${esc(q.validated ? f.day(q.validated) : f.t("extras.in_progress"))}</span></li>`)].join("");
  const kinds = Object.entries(X.event_kinds || {}).map(([k, v]) => `${evKind(k)}: ${v}`).join(" · ");
  const places = (D.campuses || []).map((c: any) => {
    const time = c.sessions ? f.t("foot.time", { hours: f.hmm(c.hours), sessions: f.num(c.sessions) }) : f.t("foot.no_sessions");
    return `<li><span><b>${esc(c.name || "?")}</b>${c.city ? ` <span class="note">${esc(c.city)}</span>` : ""}<br><span class="note">${esc(`${f.t("foot.joined", { when: f.day(c.joined) })} · ${time}`)}</span></span>`
      + (c.first ? `<span class="when">${esc(f.t("foot.span", { first: f.day(c.first), last: f.day(c.last) }))}</span>` : "") + "</li>";
  }).join("");
  return [{ id: "activity", nav: f.t("activity.title"), html: section("activity", f.t("activity.title"), cols(
    block("achievements", `<ul class="list">${ach || none}</ul>`, f.t("extras.achievements_title")),
    `<div class="block" data-panel="events"><h3>${esc(f.t("extras.events_title"))}</h3><p class="note">${esc(kinds)}</p><ul class="list">${evs || none}</ul></div>`,
    block("misc", `<ul class="list">${misc || none}</ul>`, f.t("extras.misc_title")),
    block("campuses", `<ul class="list">${places || none}</ul>`, f.t("foot.campuses")))) }];
}

/** Every section of the other pages a student can add under their profile, in the order of the band, with its title.
 * All start at full width; the student can make any of them half width. */
export const WIDGETS: [PageKey, string, string][] = [
  ["home", "activity", "activity.title"],
  ["projects", "pace", "nav.pace"], ["projects", "skills", "extras.skills_title"], ["projects", "projects-table", "nav.projects_table"],
  ["projects", "exams", "nav.exams"], ["projects", "domains", "domains.title"], ["projects", "timeline", "nav.projects"],
  ["evaluations", "community", "community.title"], ["evaluations", "by-group", "stats.group_section"], ["evaluations", "over-time", "over_time.title"],
  ["evaluations", "when", "nav.when"], ["evaluations", "feedback", "nav.feedback"], ["evaluations", "points", "nav.points"],
  ["evaluations", "cancelled", "cancel.title"], ["evaluations", "log", "nav.log"],
  ["coalition", "standing", "nav.standing"], ["coalition", "bonus", "bonus.title"], ["coalition", "coal-points", "nav.coal"],
  ["people", "who", "nav.who"], ["people", "crossed", "nav.crossed"], ["people", "connections", "nav.connections"], ["people", "circle", "nav.network"],
  ["campus", "rhythm", "rhythm.title"], ["campus", "seats", "nav.seats"], ["campus", "days", "nav.days"], ["campus", "sessions", "nav.sessions"], ["campus", "where", "nav.where"],
];
const BUILD: Record<string, (pg: Page) => Section[]> = { home: activity, projects, evaluations, coalition, people, campus };

/** The added sections on a two-column grid, each built by its own page (once per page), in the student's order, size
 * and column. */
export function widgets(pg: Page, chosen: { page: string; id: string; wide?: boolean; side?: string }[]): Section[] {
  const f = pg.f, built = new Map<string, Section[]>(), cells: string[] = [];
  const title = (page: string, id: string) => {
    const w = WIDGETS.find(([p, i]) => p === page && i === id);
    return w ? f.t(w[2]) : id;
  };
  chosen.forEach(({ page, id, wide, side }, i) => {
    if (!BUILD[page] || !WIDGETS.some(([p, k]) => p === page && k === id)) return;
    if (!built.has(page)) built.set(page, BUILD[page](pg));
    const s = built.get(page)!.find((x) => x.id === id);
    const html = s ? s.html : `<section id="${esc(id)}"><h2>${esc(title(page, id))}</h2><p class="note">${esc(f.t("widgets.none"))}</p></section>`;
    const big = wide ?? true;
    cells.push(`<div class="widget ${big ? "wide" : "half"}${!big && side ? ` ${side}` : ""}" data-widget="${esc(page)}:${esc(id)}" data-i="${i}" data-name="${esc(s?.nav || title(page, id))}">${html}</div>`);
  });
  return cells.length ? [{ id: "widget-grid", nav: f.t("widgets.title"), html: `<div class="widgets">${cells.join("")}</div>` }] : [];
}

/** The picker for the sections not added yet: centred, under a thin line (spacing.css, --picker-*), always last. */
export function widgetPicker(pg: Page, chosen: { page: string; id: string }[]): Section[] {
  const f = pg.f;
  const left = WIDGETS.filter(([p, i]) => !chosen.some((c) => c.page === p && c.id === i)).map(([p, i, k]) => [`${p}:${i}`, `${f.t(`pages.${p}`)} · ${f.t(k)}`]);
  const pick = `<label class="field"><span>${esc(f.t("widgets.add_label"))}</span><select name="widget">${left.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("")}</select></label>`
    + `<button class="btn secondary" type="button" data-widget-add>${esc(f.t("widgets.add"))}</button>`;
  return left.length ? [{ id: "widgets", nav: f.t("widgets.title"), html: `<section id="widgets" class="widget-add"><div class="add-row">${pick}</div></section>` }] : [];
}

export function profile(pg: Page, chosen: { page: string; id: string }[] = []): Section[] {
  const f = pg.f;
  return [
    { id: "profile", nav: f.t("profile.title"), html: card(pg) },
    { id: "home-kpis", nav: f.t("nav.home_kpis"), html: modules(pg) },
    ...((html) => (html ? [{ id: "path", nav: "", html: `<section id="path" class="pf-path" aria-label="${esc(f.t("profile.title"))}">${html}</section>` }] : []))(path(pg)),
    ...widgets(pg, chosen),
    ...widgetPicker(pg, chosen), // always last
  ];
}
