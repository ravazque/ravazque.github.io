// Profile (the home page): who you are, the logtime bonus and what changes today, three figures of your history, your
// campuses, and the sections of other pages the student added as widgets (kept in this browser).
import { trend } from "../lib/charts";
import { badge, esc, initials, safeColor } from "../lib/h";
import { madridParts } from "../fmt";
import { home, type Today } from "./home";
import { Page, type PageKey, type Section, monthsBetween, myRank, myTrack } from "./page";
import { projects } from "./projects";
import { evaluations } from "./evaluations";
import { coalition } from "./coalition";
import { people } from "./people";
import { campus, campuses } from "./campus";

const num = (f: Page["f"], v: number, d = 0, unit = "") =>
  `<span data-count="${v}" data-dec="${d}">${esc(f.num(v, d))}</span>${unit ? `<small>${esc(unit)}</small>` : ""}`;

/** Who this is: the photo in a rounded square, the name as a poster, one line of identity (campus, coalition, milestone,
 * grade, track, groups) and three stacks of facts (cursus · economy · dates). */
function card(pg: Page): string {
  const f = pg.f, D = pg.D, P = D.profile, dv = pg.v.derive || {};
  const cursus = new Map<string, any>((pg.v.all_cursus || D.extras.cursus || []).map((c: any) => [c.name, c]));
  const main = cursus.get("42cursus"), piscine = cursus.get("C Piscine");
  const coal = P.coalition, promo = pg.v.promo, rank = myRank(D.extras), track = myTrack(D.extras);
  const month = (s: string) => `${f.months[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
  const has = (v: any) => v !== null && v !== undefined;
  const stacks = ([
    [main ? [f.t("home.k_level"), f.level(main.level)] : null, promo ? [f.t("standing.promo"), f.t("home.promo_short", { rank: f.num(promo.rank), size: f.num(promo.size) })] : null],
    [has(P.wallet) ? [f.t("head.wallet"), `${f.num(P.wallet)} ₳`] : null, has(P.correction_point) ? [f.t("head.points"), f.num(P.correction_point)] : null],
    [main?.begin ? [f.t("profile.kickoff"), f.day(main.begin)] : null, piscine?.begin ? [f.t("profile.piscine"), month(piscine.begin)] : null,
      dv.alumni_due ? [f.t("profile.alumni"), dv.alumni_due === "paused" ? f.t("profile.paused_short") : f.day(dv.alumni_due)] : null],
  ].map((st) => st.filter(Boolean) as [string, string][]).filter((st) => st.length));
  const sub = [esc(P.login) + (P.campus_current ? ` · ${esc(P.campus_current)}` : ""),
    coal ? `<span><i class="dot" style="background:${safeColor(coal.color)}"></i>${esc(coal.name)}${coal.rank ? ` · ${esc(f.t("home.nth", { n: coal.rank }))}` : ""}</span>` : "",
    esc(rank ? f.t(`groups.${rank}`) : f.t("home.no_cursus")),
    [main?.grade ? badge(main.grade) : "", track ? badge(f.t(`profile.track_${track}`)) : "", ...(P.groups || []).map((g: string) => badge(g))].join("")]
    .filter(Boolean).map((x) => `<span>${x}</span>`).join("");
  return `<section id="profile" aria-label="${esc(f.t("profile.title"))}"><div class="pf">`
    + `<div class="avatar-lg pf-photo"><span aria-hidden="true">${esc(initials(P.name || P.login))}</span>${P.image ? `<img src="${esc(P.image)}" alt="">` : ""}</div>`
    + `<div class="pf-main"><p class="pf-name">${esc(P.name || P.login)}</p><p class="pf-sub">${sub}</p>`
    + `<div class="pf-stacks">${stacks.map((st) => `<dl>${st.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd${v === f.t("profile.paused_short") ? ` title="${esc(f.t("profile.paused"))}" data-tip="${esc(f.t("profile.paused"))}"` : ""}>${esc(v)}</dd></div>`).join("")}</dl>`).join("")}</div>`
    + `</div></div></section>`;
}

/** Three figures of your history: projects, evaluations and logged time. */
function modules(pg: Page): string {
  const f = pg.f, D = pg.D, S = D.summary, L = D.logtime;
  const finished = D.projects.filter((p: any) => p.mark !== null && p.mark !== undefined);
  const open = D.projects.filter((p: any) => p.status !== "finished" && !p.validated).length;
  const closed = D.projects.filter((p: any) => p.status === "finished" && p.validated === false).length;
  const failed = D.stats?.failed_given;
  const months = D.insights?.pace?.months || [];
  const perMonth: Record<string, number> = {};
  for (const e of [...D.received, ...D.given]) {
    const k = madridParts(e.begin_ms).iso.slice(0, 7);
    perMonth[k] = (perMonth[k] || 0) + 1;
  }
  // a series of every month from its first up to the report's, the quiet ones as zero
  const upToNow = (byMonth: Record<string, number>) => {
    const keys = Object.keys(byMonth).sort();
    return keys.length ? monthsBetween(keys[0], [keys[keys.length - 1], pg.asOf.slice(0, 7)].sort()[1]).map((k) => byMonth[k] || 0) : [];
  };
  const mods: { key: string; label: string; aside?: string; value: string; lines: string[]; trend: string }[] = [
    { key: "projects", label: f.t("home.k_projects"), aside: f.t("home.validated"), value: num(f, S.validated, 0, ` / ${f.num(S.projects)}`),
      lines: [f.t("home.attempts", { attempts: S.attempts, retries: S.retries }),
        finished.length ? f.t("home.avg_mark", { mark: f.num(finished.reduce((s: number, p: any) => s + p.mark, 0) / finished.length, 1) }) : "",
        [open ? f.plural(open, "count.open") : "", closed ? f.plural(closed, "count.closed") : ""].filter(Boolean).join(" · ")],
      trend: trend(months.map((m: any) => m.validated), { bars: true, last: true }) },
    { key: "evals", label: f.t("home.k_evals"), aside: f.t("home.received_given"), value: num(f, S.received, 0, ` · ${f.num(S.given)}`),
      lines: [f.t("home.out", { received: S.received_outstanding, given: S.given_outstanding }),
        failed && failed.pct !== null && failed.pct !== undefined ? f.t("home.failed", { pct: `${f.num(failed.pct, 1)}%` }) : ""],
      trend: trend(upToNow(perMonth)) },
    { key: "hours", label: f.t("home.k_hours"), aside: f.t(`period.${pg.period}`), value: num(f, Math.round(L.total_seconds / 360) / 10, 1, " h"),
      lines: [f.t("home.days", { days: f.plural(L.days_present, "count.days") }),
        L.days_present ? f.t("home.hours_avg", { time: f.hm(L.total_seconds / L.days_present) }) : ""],
      trend: trend(upToNow(L.monthly || {}), { bars: true, last: true }) },
  ];
  return `<section id="home-kpis" class="modules-wrap"><h2 class="visually-hidden">${esc(f.t("home.title"))}</h2><div class="modules">`
    + mods.map((x) => `<article class="module" data-module="${x.key}"><h3 class="tab">${esc(x.label)}${x.aside ? `<span>${esc(x.aside)}</span>` : ""}</h3>`
      + `<p class="figure">${x.value}</p>`
      + x.lines.filter(Boolean).map((l) => `<p class="line">${esc(l)}</p>`).join("") + x.trend + "</article>").join("") + "</div></section>";
}

/** Every section of the other pages a student can add under their profile, in the order of the band, with its title.
 * The ones in HALF start in one column (left or right); the rest take both (the student can change either). */
export const WIDGETS: [Exclude<PageKey, "home">, string, string][] = [
  ["projects", "pace", "nav.pace"], ["projects", "skills", "extras.skills_title"], ["projects", "projects-table", "nav.projects_table"],
  ["projects", "exams", "nav.exams"], ["projects", "domains", "domains.title"], ["projects", "timeline", "nav.projects"], ["projects", "activity", "activity.title"],
  ["evaluations", "community", "community.title"], ["evaluations", "by-group", "stats.group_section"], ["evaluations", "over-time", "over_time.title"],
  ["evaluations", "when", "nav.when"], ["evaluations", "feedback", "nav.feedback"], ["evaluations", "points", "nav.points"],
  ["evaluations", "log", "nav.log"],
  ["coalition", "standing", "nav.standing"], ["coalition", "bonus", "bonus.title"], ["coalition", "coal-points", "nav.coal"],
  ["people", "who", "nav.who"], ["people", "crossed", "nav.crossed"], ["people", "connections", "nav.connections"], ["people", "circle", "nav.network"],
  ["people", "teammates", "nav.teammates"],
  ["campus", "rhythm", "rhythm.title"], ["campus", "seats", "nav.seats"], ["campus", "days", "nav.days"], ["campus", "sessions", "nav.sessions"], ["campus", "where", "nav.where"],
];
export const HALF = new Set(["exams", "by-group", "points", "standing", "bonus", "coal-points", "teammates", "rhythm", "community"]);
const BUILD: Record<string, (pg: Page) => Section[]> = { projects, evaluations, coalition, people, campus };

/** The added sections on a two-column grid, each built by its own page (once per page), in the student's order, size
 * and column; then the picker for more. */
function widgets(pg: Page, chosen: { page: string; id: string; wide?: boolean; side?: string }[]): Section[] {
  const f = pg.f, built = new Map<string, Section[]>(), out: Section[] = [], cells: string[] = [];
  const title = (page: string, id: string) => {
    const w = WIDGETS.find(([p, i]) => p === page && i === id);
    return w ? f.t(w[2]) : id;
  };
  chosen.forEach(({ page, id, wide, side }, i) => {
    if (!BUILD[page] || !WIDGETS.some(([p, k]) => p === page && k === id)) return;
    if (!built.has(page)) built.set(page, BUILD[page](pg));
    const s = built.get(page)!.find((x) => x.id === id);
    const html = s ? s.html : `<section id="${esc(id)}"><h2>${esc(title(page, id))}</h2><p class="note">${esc(f.t("widgets.none"))}</p></section>`;
    const big = wide ?? !HALF.has(id);
    cells.push(`<div class="widget ${big ? "wide" : "half"}${!big && side ? ` ${side}` : ""}" data-widget="${esc(page)}:${esc(id)}" data-i="${i}" data-name="${esc(s?.nav || title(page, id))}">${html}</div>`);
  });
  if (cells.length) out.push({ id: "widget-grid", nav: f.t("widgets.title"), html: `<div class="widgets">${cells.join("")}</div>` });
  const left = WIDGETS.filter(([p, i]) => !chosen.some((c) => c.page === p && c.id === i));
  if (left.length) out.push({ id: "widgets", nav: f.t("widgets.title"), html: `<section id="widgets" class="widget-add">`
    + `<label class="field"><span>${esc(f.t("widgets.add_label"))}</span><select name="widget">${left.map(([p, i, k]) =>
      `<option value="${p}:${i}">${esc(`${f.t(`pages.${p}`)} · ${f.t(k)}`)}</option>`).join("")}</select></label>`
    + `<button class="btn secondary" type="button" data-widget-add>${esc(f.t("widgets.add"))}</button></section>` });
  return out;
}

export function profile(pg: Page, td: Today | null, chosen: { page: string; id: string }[] = []): Section[] {
  const f = pg.f;
  return [
    { id: "profile", nav: f.t("profile.title"), html: card(pg) },
    ...(td ? home(f, td) : []),
    { id: "home-kpis", nav: f.t("nav.home_kpis"), html: modules(pg) },
    ...campuses(pg),
    ...widgets(pg, chosen),
  ];
}
