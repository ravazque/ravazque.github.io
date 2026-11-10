import { expect, test } from "vitest";
import { achievementSeries, activity, profile, widgetPicker, widgets } from "./profile";
import { Page } from "./page";
import { Fmt } from "../fmt";
import { tryChip } from "./projects";

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
const cardLines = (pg: Page) => [...profile(pg)[0].html.matchAll(/<p class="line">(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").trim());

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
