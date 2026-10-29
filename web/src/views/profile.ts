// Profile (the home page): who you are, what changes today, v1's six modules and the panels v1's Home held (rhythm,
// pace, skills, coalitions and promo, coalition points, activity, campuses). Sections built for other pages are
// reused by id, so a panel is defined once wherever it is shown.
import { trend } from "../lib/charts";
import { badge, esc, initials, safeColor } from "../lib/h";
import { madridParts } from "../fmt";
import { home, type Today } from "./home";
import { Page, type Section, myRank, msOf } from "./page";
import { projects } from "./projects";
import { people } from "./people";
import { campus } from "./campus";

/** Ids each page leaves to Profile (the v1 Home panels), in Profile's order. */
export const PROFILE_FROM = {
  campus: ["rhythm"], projects: ["pace", "skills"], people: ["standing"], campusBonus: ["bonus"], peopleCoal: ["coal-points"],
  projectsActivity: ["activity"], campusPlaces: ["campuses"],
};
export const ON_PROFILE = new Set(Object.values(PROFILE_FROM).flat());

const num = (f: Page["f"], v: number, d = 0, unit = "") =>
  `<span data-count="${v}" data-dec="${d}">${esc(f.num(v, d))}</span>${unit ? `<small>${esc(unit)}</small>` : ""}`;

/** Who this is (photo, name, campus, coalition, rank, grade, groups) and what the intra keeps on the profile. */
function card(pg: Page): string {
  const f = pg.f, D = pg.D, P = D.profile, dv = pg.v.derive || {};
  const cursus = new Map<string, any>((pg.v.all_cursus || D.extras.cursus || []).map((c: any) => [c.name, c]));
  const main = cursus.get("42cursus"), piscine = cursus.get("C Piscine");
  const coal = P.coalition, promo = pg.v.promo, rank = myRank(D.extras);
  const month = (s: string) => `${f.months[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
  const facts = ([
    main ? [f.t("home.k_level"), f.num(main.level, 2)] : null,
    promo ? [f.t("standing.promo"), `${f.num(promo.rank)} / ${f.num(promo.size)}`] : null,
    P.wallet !== null && P.wallet !== undefined ? [f.t("head.wallet"), `${f.num(P.wallet)} ₳`] : null,
    P.correction_point !== null && P.correction_point !== undefined ? [f.t("head.points"), f.num(P.correction_point)] : null,
    piscine?.begin ? [f.t("profile.piscine"), month(piscine.begin)] : null,
    main?.begin ? [f.t("profile.kickoff"), f.day(main.begin)] : null,
    dv.alumni_due ? [f.t("profile.alumni"), dv.alumni_due === "paused" ? f.t("profile.paused") : f.day(dv.alumni_due)] : null,
    coal ? [f.t("home.k_coalition"), coal.rank ? `${coal.name} · ${f.t("home.nth", { n: coal.rank })}` : coal.name] : null,
  ].filter(Boolean) as [string, string][]);
  const coalLine = (coal ? `<i class="dot" style="background:${safeColor(coal.color)}"></i>${esc(coal.name)} · ` : "")
    + esc(rank ? f.t(`groups.${rank}`) : f.t("home.no_cursus")) + (main?.grade ? ` ${badge(main.grade)}` : "");
  const now = P.location ? f.t("rail.now_at", { seat: P.location }) : f.t("rail.not_logged");
  const gen = D.generated || "";
  return `<section id="profile" aria-label="${esc(f.t("profile.title"))}"><div class="id-card">`
    + `<div class="avatar-lg"><span aria-hidden="true">${esc(initials(P.name || P.login))}</span>${P.image ? `<img src="${esc(P.image)}" alt="">` : ""}</div>`
    + `<div class="id-text"><p class="name">${esc(P.name || P.login)}</p><p>${esc(P.login)}${P.campus_current ? ` · ${esc(P.campus_current)}` : ""}</p>`
    + `<p class="coal">${coalLine}</p>${(P.groups || []).length ? `<p class="groups">${P.groups.map((g: string) => badge(g)).join("")}</p>` : ""}</div>`
    + `<dl class="id-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`
    + `<p class="id-now">${esc(now)} · ${esc(f.t("head.generated", { when: gen ? `${f.day(gen)}, ${gen.slice(11, 16)}` : "" }))}</p></div></section>`;
}

/** v1's six modules: level, projects, evaluations, coalition, the logtime bonus and hours. */
function modules(pg: Page): string {
  const f = pg.f, D = pg.D, S = D.summary, L = D.logtime, X = D.extras, dv = pg.v.derive || {};
  const level = (X.cursus || []).find((c: any) => c.name === "42cursus") || (X.cursus || [])[0];
  const rank = myRank(X), promo = pg.v.promo;
  const xp = D.projects.reduce((s: number, p: any) => s + (p.xp_earned || 0), 0);
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
  const coal = D.profile.coalition, cp = D.coalition_points;
  const mods: { key: string; label: string; aside?: string; value: string; lines: string[]; trend: string; live?: boolean; meter?: string; chip?: string }[] = [
    { key: "level", label: f.t("home.k_level"), aside: level ? f.t("home.cursus") : "", value: level ? num(f, level.level, 2) : "–",
      lines: [rank ? f.t("home.rank", { rank: f.t(`groups.${rank}`) }) : f.t("home.no_cursus"),
        promo ? f.t("home.promo", { rank: f.num(promo.rank), size: f.num(promo.size) }) : f.t("home.xp", { xp: f.num(xp) })],
      trend: trend(months.map((m: any) => m.cumulative)) },
    { key: "projects", label: f.t("home.k_projects"), aside: f.t("home.validated"), value: num(f, S.validated, 0, ` / ${f.num(S.projects)}`),
      lines: [f.t("home.attempts", { attempts: S.attempts, retries: S.retries }),
        finished.length ? f.t("home.avg_mark", { mark: f.num(finished.reduce((s: number, p: any) => s + p.mark, 0) / finished.length, 1) }) : "",
        [open ? f.plural(open, "count.open") : "", closed ? f.plural(closed, "count.closed") : ""].filter(Boolean).join(" · ")],
      trend: trend(months.map((m: any) => m.validated), { bars: true, last: true }) },
    { key: "evals", label: f.t("home.k_evals"), aside: f.t("home.received_given"), value: num(f, S.received, 0, ` · ${f.num(S.given)}`),
      lines: [f.t("home.out", { received: S.received_outstanding, given: S.given_outstanding }),
        failed && failed.pct !== null && failed.pct !== undefined ? f.t("home.failed", { pct: `${f.num(failed.pct, 1)}%` }) : ""],
      trend: trend(Object.keys(perMonth).sort().map((k) => perMonth[k])) },
    { key: "coalition", label: f.t("home.k_coalition"), aside: coal?.name || "",
      value: coal?.rank ? esc(f.t("home.nth", { n: coal.rank })) + (coal.master ? `<small> · ${esc(f.t("home.master"))}</small>` : "") : "–",
      lines: [coal && coal.score !== null && coal.score !== undefined ? f.t("home.season", { n: f.num(coal.score) }) : f.t("home.no_coalition"),
        cp ? f.t("home.points_total", { n: f.num(cp.total) }) : ""],
      trend: cp ? trend(cp.months.map((m: any) => m.logtime + m.other), { bars: true, last: true }) : "" },
    bonusModule(pg, dv),
    { key: "hours", label: f.t("home.k_hours"), aside: f.t(`period.${pg.period}`), value: num(f, Math.round(L.total_seconds / 360) / 10, 1, " h"),
      lines: [f.t("home.days", { days: f.plural(L.days_present, "count.days") }),
        L.days_present ? f.t("home.hours_avg", { time: f.hm(L.total_seconds / L.days_present) }) : ""],
      trend: trend(Object.values(L.monthly || {}) as number[], { bars: true, last: true }) },
  ];
  return `<section id="home-kpis" class="modules-wrap"><h2 class="visually-hidden">${esc(f.t("home.title"))}</h2><div class="modules">`
    + mods.map((x) => `<article class="module${x.live ? " live" : ""}" data-module="${x.key}"><h3 class="tab">${esc(x.label)}${x.aside ? `<span>${esc(x.aside)}</span>` : ""}</h3>`
      + `<p class="figure">${x.value}</p>${x.meter || ""}${x.chip ? `<p class="chip-live">${esc(x.chip)}</p>` : ""}`
      + x.lines.filter(Boolean).map((l) => `<p class="line">${esc(l)}</p>`).join("") + x.trend + "</article>").join("") + "</div></section>";
}

/** v1's live module: the rolling week against 50 h and 80 h, and the next bonus within reach (inferred rule). */
function bonusModule(pg: Page, dv: any) {
  const f = pg.f, W = pg.D.logtime_bonus, tiers = dv.logtime_bonus as any[] | null;
  if (!W || !tiers || pg.period === "piscine")
    return { key: "bonus", label: f.t("home.k_bonus"), aside: f.t("coal.k_window"), value: "–", lines: [f.t("home.no_bonus")], trend: "" };
  const [t50, t80] = tiers;
  const when = (iso: string) => f.stamp(msOf(iso));
  const nxt = [t50, t80].find((t) => t.state !== "cooldown" && t.window_h < t.hours) || [t50, t80].find((t) => t.state === "ready");
  const chip = !nxt ? f.t("home.bonus_wait") : nxt.state === "ready" ? f.t("home.bonus_due", { hours: nxt.hours, points: f.num(nxt.points) })
    : f.t("home.bonus_short", { hours: nxt.hours, n: f.num(nxt.need_h, 1), time: nxt.until ? when(nxt.until) : "–" });
  const pct = Math.min(100, (100 * t80.window_h) / 80);
  const meter = `<span class="meter" role="img" aria-label="${esc(f.t("coal.s_meter", { have: f.num(t80.window_h, 1), need: 80 }))}"><i style="width:${pct.toFixed(1)}%"></i><em style="left:62.5%"></em></span>`;
  return { key: "bonus", label: f.t("home.k_bonus"), aside: f.t("coal.k_window"), live: true, value: num(f, t80.window_h, 1, " h"), meter, chip,
    lines: [t50, t80].filter((t) => t !== nxt).map((t) => (t.state === "cooldown" ? f.t("home.bonus_from", { hours: t.hours, time: when(t.from) })
      : t.state === "ready" ? f.t("home.bonus_ready", { hours: t.hours }) : f.t("home.bonus_rest", { hours: t.hours, n: f.num(t.need_h, 1) }))), trend: "" };
}

export function profile(pg: Page, td: Today | null): Section[] {
  const f = pg.f;
  const pick = (from: Section[], ids: string[]) => ids.flatMap((id) => from.filter((s) => s.id === id));
  const P = projects(pg), Pe = people(pg), C = campus(pg);
  const today = td ? home(f, td) : [];
  return [
    { id: "profile", nav: f.t("profile.title"), html: card(pg) },
    ...today,
    { id: "home-kpis", nav: f.t("nav.home_kpis"), html: modules(pg) },
    ...pick(C, PROFILE_FROM.campus), ...pick(P, PROFILE_FROM.projects), ...pick(Pe, PROFILE_FROM.people),
    ...pick(C, PROFILE_FROM.campusBonus), ...pick(Pe, PROFILE_FROM.peopleCoal), ...pick(P, PROFILE_FROM.projectsActivity),
    ...pick(C, PROFILE_FROM.campusPlaces),
  ];
}
