import { expect, test } from "vitest";
import { achievementSeries, activity, profile, widgetPicker, widgets } from "./profile";
import { Page } from "./page";
import { Fmt } from "../fmt";
import { projectFilters, projectView, projects, timelineLanes, tryChip } from "./projects";

const a = (name: string, description: string, at: string) => ({ name, description, at, tier: "none" });

test("achievements of one series show their highest level first and keep the others", () => {
  const s = achievementSeries([
    a("Attendee", "Attended 1 event.", "2025-09-20"), a("Attendee", "Attended 21 events.", "2026-03-02"),
    a("Solo", "Did it once.", "2026-01-01"), a("Attendee", "Attended 3 events.", "2025-10-04"),
    a("Rich", "Collected 1.000 wallet points.", "2026-02-01"), a("Rich", "Collected 200 wallet points.", "2026-02-01"),
    a("Code Explorer", "Validated your first project.", "2024-10-01"), a("Code Explorer", "Validated 3 projects", "2024-11-01"),
  ]);
  expect(s.map((x) => [x.top.description, x.rest.map((r) => r.description)])).toEqual([
    ["Attended 21 events.", ["Attended 3 events.", "Attended 1 event."]],
    ["Collected 1.000 wallet points.", ["Collected 200 wallet points."]],
    ["Did it once.", []],
    ["Validated 3 projects", ["Validated your first project."]],
  ]);
});

test("an exam try with no mark is a grey chip, not a red one", () => {
  const f = new Fmt("en");
  expect(tryChip(f, { mark: null, passed: false, date: "2026-03-02" })).toMatch(/^<span class="mark" title="[^"]+">–<\/span>$/);
  expect(tryChip(f, { mark: 0, passed: false, date: "2026-03-02" })).toContain('class="mark fail"');
  expect(tryChip(f, { mark: 100, passed: true, date: "2026-03-02" })).toContain('class="mark pass"');
});

test("Activity holds the campuses you have been to, beside titles, expertises and quests", () => {
  const f = new Fmt("en");
  const D = { extras: { achievements: [], events: [], titles: [], expertises: [], quests: [], event_kinds: {} },
    campuses: [{ name: "Madrid", city: "Madrid", joined: "2024-09-16", sessions: 3, hours: 12.5, first: "2024-09-16", last: "2026-11-01" }] };
  const [s] = activity(new Page(f, { report: D, all_projects: [] } as any, "home", {}));
  expect(s.id).toBe("activity");
  const panels = [...s.html.matchAll(/data-panel="([a-z-]+)"/g)].map((m) => m[1]);
  expect(panels).toEqual(["achievements", "events", "misc", "campuses"]);
  expect(s.html).toContain(f.t("foot.campuses"));
  expect(s.html).toContain("12:30h");
});

const extras = { achievements: [], events: [], titles: [{ name: "Mastermind", selected: true, at: "2026-05-18" }], expertises: [], quests: [], event_kinds: {} };
const activityPage = () => new Page(new Fmt("en"), { report: { extras, campuses: [] }, all_projects: [] } as any, "home", {});

test("no tag on the selected title", () => {
  const [s] = activity(activityPage());
  expect(s.html).toContain("Mastermind");
  expect(s.html).not.toContain("selected");
});

test("Activity is a widget like the rest: offered in the picker until added, then drawn with the others", () => {
  expect(widgetPicker(activityPage(), [])[0].html).toContain('value="home:activity"');
  expect(widgetPicker(activityPage(), [{ page: "home", id: "activity" }])[0].html).not.toContain('value="home:activity"');
  const [grid] = widgets(activityPage(), [{ page: "home", id: "activity", wide: false }]);
  expect(grid.html).toContain('class="widget half" data-widget="home:activity"');
  expect(grid.html).toContain('data-panel="achievements"');
  expect(profile(cardPage()).map((s) => s.id)).not.toContain("activity"); // only as a widget
});

const cardPage = (more: any = {}) => new Page(new Fmt("en"), { period: "student", report: {
  profile: { login: "peer01", wallet: 576, correction_point: 5 }, extras: { ...extras, cursus: [{ name: "42cursus", level: 17.29, grade: "Transcender" }] },
  correction_points: { earned: 12, spent: 8 }, summary: { validated: 0, projects: 0, attempts: 0, retries: 0, received: 0, given: 0 },
  logtime: { total_seconds: 0, days_present: 0 }, projects: [{ status: "finished", validated: false }] }, all_projects: [],
  promo: { rank: 3, size: 424, percentile: 99.5, median: 9.2 }, ...more } as any, "home", {});
const cardLines = (pg: Page) => [...profile(pg)[0].html.matchAll(/<p class="line">(.*?)<\/p>/g)].map((m) => (Object.assign(document.createElement("p"), { innerHTML: m[1] }).textContent || "").trim());

test("the four figures of the card each carry a line: your place in Madrid, in your kickoff, the wallet, the points", () => {
  const f = new Fmt("en");
  expect(cardLines(cardPage({ madrid: { size: 913, rank: 30, top: 3.3 } }))).toEqual([f.t("profile.madrid_top", { pct: "3.3" }),
    f.t("profile.promo_line", { pct: "99.5" }), f.t("profile.wallet_line"),
    f.t("profile.points_line", { earned: "13", spent: "8" })]); // 5 = 12 - 8 + 1 left from the Piscine, counted as earned
  expect(profile(cardPage({ madrid: { size: 913, rank: 30, top: 3.3 } }))[0].html).toContain(f.t("profile.madrid_tip", { n: "913" }));
});

test("low in Madrid it says how many you are above; with no Madrid figures yet, the way to the next level", () => {
  const f = new Fmt("en");
  expect(cardLines(cardPage({ madrid: { size: 1000, rank: 801, top: 80.1 } }))[0]).toBe(f.t("profile.madrid_above", { pct: "19.9" }));
  expect(cardLines(cardPage())[0]).toBe(f.t("profile.level_next", { pct: 29, next: 18 }));
});

test("the projects module no longer counts the ones closed without validating", () => {
  const html = profile(cardPage())[1].html;
  expect(html).not.toContain(new Fmt("en").plural(1, "count.closed"));
});

test("the card's figures count up like the modules", () => {
  const html = profile(cardPage())[0].html;
  expect(html.match(/data-count=/g)?.length).toBe(4);
});

test("a widget starts at full width, and keeps the half width the student chose", () => {
  const pg = new Page(new Fmt("en"), { report: { coalition_points: { sources: [], months: [], bonuses: [] }, given: [], projects: [] }, all_projects: [] } as any, "home", {});
  expect(widgets(pg, [{ page: "coalition", id: "bonus" }])[0].html).toContain('class="widget wide"');
  expect(widgets(pg, [{ page: "coalition", id: "bonus", wide: false }])[0].html).toContain('class="widget half"');
});

test("the card names who you are beside your name, and lists coalition, milestone, grade, track and groups as tags", () => {
  const f = new Fmt("en");
  const pg = (grade: string | null, more: any = {}) => new Page(f, { period: "student", report: {
    profile: { login: "peer01", name: "Pat Peer", groups: ["Mentor"], coalition: { name: "Zefiria", color: "#e39f0b", rank: 3 }, ...more },
    extras: { ...extras, titles: [], cursus: [{ name: "42cursus", level: 9.5, grade }], quests: [{ name: "Common Core Rank 02", validated: "2026-01-01" }] },
    summary: { validated: 0, projects: 0, attempts: 0, retries: 0, received: 0, given: 0 }, logtime: { total_seconds: 0, days_present: 0 }, projects: [] }, all_projects: [] } as any, "home", {});
  const student = profile(pg(null))[0].html;
  expect(student).toContain(`<span class="pf-status">${f.t("profile.st_student")}</span>`);
  expect(student).toContain('<span class="badge">Zefiria</span>'); // its name alone: no dot, no place
  expect(student).not.toContain(f.t("home.nth", { n: 3 }));
  expect(student).toContain(`<span class="badge">${f.t("groups.rank-03")}</span>`);
  expect(student).toContain('<span class="badge">Mentor</span>');
  expect(profile(pg("Transcender"))[0].html).toContain(`<span class="pf-status">${f.t("profile.st_outer")}</span>`);
  expect(profile(pg("Alumni"))[0].html).toContain(`<span class="pf-status">${f.t("profile.st_alumni")}</span>`);
});

test("the projects table filters by status (the ones your projects have) and by a validated mark", () => {
  const p = (name: string, status: string, mark: number | null, validated: boolean | null) => ({ name, status, mark, validated, track: "student", attempts: [], registered: "2026-01-01" });
  const all = [p("Libft", "finished", 100, true), p("minishell", "waiting_for_correction", null, null), p("cub3d", "searching_a_group", null, null), p("pipex", "finished", 40, false)];
  const page = (q: Record<string, string>) => new Page(new Fmt("en"), { period: "student", report: { projects: all }, all_projects: all } as any, "projects", q);
  const names = (q: Record<string, string>) => projectView(all, projectFilters(page(q))).map((x) => x.name);
  expect(projectFilters(page({})).statuses).toEqual(["finished", "waiting_for_correction", "searching_a_group"]);
  expect(names({ status: "waiting_for_correction" })).toEqual(["minishell"]);
  expect(names({ status: "searching_a_group" })).toEqual(["cub3d"]);
  expect(names({ status: "nonsense" })).toEqual(["Libft", "minishell", "cub3d", "pipex"]);
  expect(names({ marks: "ok" })).toEqual(["Libft"]);
});

const at = (name: string, group: string, spans: [number, number][], o: any = {}) => ({ name, group, track: group === "piscine" ? "piscine" : "common-core", status: "finished", mark: 100, validated: true,
  registered: "2026-01-01", first_ms: spans[0][0], xp_earned: 0, xp_base: 0, outstanding: 0, ...o,
  attempts: spans.map(([a, b], i) => ({ n: i + 1, start_ms: a, end_ms: b, start: "2026-01-01 10:00", validated: true, mark: 100, days: 1, evals: [] })) });

test("the attempts line has a row per milestone, not per project: exams out, work experience on its own, attempts at the same time on a row under", () => {
  const rows = timelineLanes([at("Libft", "rank-00", [[0, 10]]), at("get_next_line", "rank-01", [[10, 20]]), at("ft_printf", "rank-01", [[15, 30]]), at("Born2beroot", "rank-01", [[30, 40]]),
    at("Exam Rank 02", "rank-02", [[40, 41]], { exam: true }), at("Work Exp. I - Duration", "outer-core", [[50, 60]]), at("ft_ls", "outer-core", [[50, 70]])], (g) => g.toUpperCase());
  expect(rows.map(([label, spans]) => [label, spans.map((s) => s.name)])).toEqual([
    ["RANK-00", ["Libft"]], ["RANK-01", ["get_next_line", "Born2beroot"]], ["", ["ft_printf"]], ["OUTER-CORE", ["ft_ls"]], ["WORK", ["Work Exp. I - Duration"]]]);
});

test("the projects table is one open list like the evaluation log: no groups, its count in the title, a milestone filter, Clear filters while one is set", () => {
  const all = [at("Libft", "rank-00", [[1, 2]]), at("get_next_line", "rank-01", [[3, 4]]), at("ft_printf", "rank-01", [[5, 6]], { status: "in_progress" })];
  const html = (q: Record<string, string>) => {
    const f = new Fmt("en");
    const D = { projects: all, extras: { cursus: [], skills: [] }, insights: {}, summary: {} };
    return projects(new Page(f, { period: "student", report: D, all_projects: all, derive: {} } as any, "projects", q)).find((s) => s.id === "projects-table")!.html;
  };
  const rowsOf = (h: string) => [...h.matchAll(/<td class="proj" data-v="([^"]+)"/g)].map((m) => m[1]);
  const first = html({});
  expect(first).not.toContain('<tbody class="group');
  expect(rowsOf(first)).toEqual(["ft_printf", "get_next_line", "Libft"]); // newest first
  expect(first).toContain('class="table-wrap tall"'); // the log's box
  expect(first).toMatch(/<h2>Projects<span class="count"><span class="sep"> · <\/span>3 projects<\/span><\/h2>/);
  expect(first).toMatch(/<option value="rank-01"[^>]*>Milestone 1</);
  expect(first).not.toMatch(/<option value="rank-02"/); // only the milestones your projects have
  expect(first).not.toContain("log-clear");
  const one = html({ milestone: "rank-01" });
  expect(rowsOf(one)).toEqual(["ft_printf", "get_next_line"]);
  expect(one).toContain("log-clear");
  expect(rowsOf(html({ milestone: "nonsense" })).length).toBe(3);
});

test("projects of another cursus (a Discovery piscine, a Piscine Reload) are a milestone of their own, in the table's filter and on the attempts line", () => {
  const all = [at("ft_ls", "outer-core", [[1, 2]], { slug: "ft_ls", track: "outer-core" }), at("Cellule0.0 - Shell", "outer-core", [[3, 4]], { slug: "cellule0-0-shell", track: "outer-core" }),
    at("Piscine Django", "outer-core", [[5, 6]], { slug: "piscine-django", track: "outer-core" })];
  const D = { projects: all, extras: { cursus: [], skills: [] }, insights: {}, summary: {}, given: [],
    received: [{ slug: "cellule0-0-shell", cursus: ["Discovery Piscine - Web"] }, { slug: "ft_ls", cursus: ["42cursus", "42Senior"] }] };
  const f = new Fmt("en");
  const secs = projects(new Page(f, { period: "student", report: D, all_projects: all, derive: {} } as any, "projects", {}));
  const table = secs.find((s) => s.id === "projects-table")!.html;
  expect(table).toContain(`<option value="outside">${f.t("projects.outside")}</option>`);
  const only = (m: string) => [...projects(new Page(f, { period: "student", report: D, all_projects: all, derive: {} } as any, "projects", { milestone: m }))
    .find((s) => s.id === "projects-table")!.html.matchAll(/<td class="proj" data-v="([^"]+)"/g)].map((x) => x[1]).sort();
  expect(only("outside")).toEqual(["Cellule0.0 - Shell"]);
  expect(only("outer-core")).toEqual(["Piscine Django", "ft_ls"]); // not evaluated in another cursus: it stays
  expect(secs.find((s) => s.id === "timeline")!.html).toContain(`title="${f.t("projects.outside")}"`);
});
