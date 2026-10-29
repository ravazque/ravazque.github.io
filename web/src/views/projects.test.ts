import { expect, test } from "vitest";
import { achievementSeries } from "./projects";

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
