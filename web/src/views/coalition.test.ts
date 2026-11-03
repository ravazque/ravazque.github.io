import { expect, test } from "vitest";
import { Fmt } from "../fmt";
import { allPoints } from "./coalition";
import { Page } from "./page";

const award = (i: number) => ({ at: `2026-01-${String(1 + i).padStart(2, "0")}T10:00:00.000Z`, key: "evaluations", points: 250, id: i });
const pageWith = (points: any) => new Page(new Fmt("en"), { report: { coalition_points: points, given: [{ id: 3, project: "minishell" }], projects: [] }, all_projects: [] } as any, "coalition", {});

test("All points lists every award, with what it came from", () => {
  const html = allPoints(pageWith({ awards: [award(3), award(2), award(1)], recent: [award(3)] }));
  expect(html.match(/<li>/g)?.length).toBe(3);
  expect(html).toContain("Evaluated minishell");
});

test("a report saved before every award was kept shows its latest ones", () => {
  expect(allPoints(pageWith({ recent: [award(3), award(2)] })).match(/<li>/g)?.length).toBe(2);
});

test("a deduction in All points reads as minus, in red, never +-", () => {
  const html = allPoints(pageWith({ awards: [{ ...award(2), points: -250 }, award(1)] }));
  expect(html).not.toContain("+-");
  expect(html).toContain('<span class="when neg">-250</span>');
  expect(html).toContain('<span class="when">+250</span>');
});
