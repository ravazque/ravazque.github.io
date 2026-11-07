import { expect, test } from "vitest";
import { achievementSeries, activity, widgetPicker, widgets } from "./profile";
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
  expect(s.html).toContain("12.5h");
});

const extras = { achievements: [], events: [], titles: [{ name: "Mastermind", selected: true, at: "2026-05-18" }], expertises: [], quests: [], event_kinds: {} };
const activityPage = () => new Page(new Fmt("en"), { report: { extras, campuses: [] }, all_projects: [] } as any, "home", {});

test("no tag on the selected title", () => {
  const [s] = activity(activityPage());
  expect(s.html).toContain("Mastermind");
  expect(s.html).not.toContain("selected");
});

test("Activity minimized keeps its title and nothing under it; hidden it is gone and the picker offers it back", () => {
  const [min] = activity(activityPage(), "min");
  expect(min.html).toContain(new Fmt("en").t("activity.title"));
  expect(min.html).not.toContain("data-panel");
  expect(activity(activityPage(), "off")).toEqual([]);
  expect(widgetPicker(activityPage(), [], "off")[0].html).toContain('value="home:activity"');
  expect(widgetPicker(activityPage(), [], "")[0].html).not.toContain('value="home:activity"');
});

test("a widget starts at full width, and keeps the half width the student chose", () => {
  const pg = new Page(new Fmt("en"), { report: { coalition_points: { sources: [], months: [], bonuses: [] }, given: [], projects: [] }, all_projects: [] } as any, "home", {});
  expect(widgets(pg, [{ page: "coalition", id: "bonus" }])[0].html).toContain('class="widget wide"');
  expect(widgets(pg, [{ page: "coalition", id: "bonus", wide: false }])[0].html).toContain('class="widget half"');
});
