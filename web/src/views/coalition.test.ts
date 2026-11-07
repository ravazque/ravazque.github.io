import { expect, test } from "vitest";
import { Fmt } from "../fmt";
import { allPoints, coalition, everySource, tigSplit } from "./coalition";
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

const tig = (at: string, points = -2100) => ({ at, key: "other", points, id: 1 });

test("points taken away are TIGs, apart from the other sources and in their month", () => {
  const P = { sources: [{ key: "evaluations", points: 500, count: 2 }, { key: "other", points: -2520, count: 3 }],
    months: [{ month: "2026-01", logtime: 0, other: -3700 }, { month: "2026-02", logtime: 500, other: 1680 }],
    awards: [tig("2026-01-10T10:00:00Z"), tig("2026-01-20T10:00:00Z"), { at: "2026-01-21T10:00:00Z", key: "evaluations", points: 500, id: 2 },
      { at: "2026-02-21T10:00:00Z", key: "other", points: 1680, id: 3 }] };
  const { sources, months } = tigSplit(P);
  expect(sources).toEqual([{ key: "evaluations", points: 500, count: 2 }, { key: "other", points: 1680, count: 1 }, { key: "tigs", points: -4200, count: 2 }]);
  expect(months[0]).toEqual({ month: "2026-01", logtime: 0, other: 500, tigs: -4200 });
  expect(months[1]).toEqual({ month: "2026-02", logtime: 500, other: 1680, tigs: 0 });
});

test("with no other source left, Other goes; a report without every award stays as it was", () => {
  expect(tigSplit({ sources: [{ key: "other", points: -2100, count: 1 }], months: [], awards: [tig("2026-01-10T10:00:00Z")] }).sources.map((s: any) => s.key)).toEqual(["tigs"]);
  const old = { sources: [{ key: "other", points: -2100, count: 1 }], months: [{ month: "2026-01", logtime: 0, other: -2100 }], recent: [] };
  expect(tigSplit(old).sources).toEqual(old.sources);
  expect(tigSplit(old).months[0].tigs).toBe(0);
});

test("All points calls a deduction a TIG", () => {
  const html = allPoints(pageWith({ awards: [tig("2026-01-10T10:00:00Z")] }));
  expect(html).toContain("TIGs");
  expect(html).not.toContain(">Other<");
});

test("All points shows templates of the rows to come while it has room, and none once it is full", () => {
  const fill = (n: number) => allPoints(pageWith({ awards: Array.from({ length: n }, (_, i) => award(i % 20)) }));
  expect(fill(2)).toContain('class="fill"');
  expect(fill(24)).not.toContain('class="fill"');
});

test("every source shows, at nothing too: biggest first, zeros in their order, what takes points away last", () => {
  const keys = (src: any[]) => everySource(src).map((s: any) => [s.key, s.points]);
  expect(keys([{ key: "tigs", points: -2100, count: 1 }, { key: "projects", points: 900, count: 1 }])).toEqual([["projects", 900], ["evaluations", 0], ["exams", 0], ["logtime_50", 0],
    ["logtime_80", 0], ["wallet", 0], ["other", 0], ["tigs", -2100]]);
  expect(everySource([]).map((s: any) => s.count)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test("Points by source reads from its title, with every source, also for someone with no points yet", () => {
  const f = new Fmt("en");
  const html = coalition(pageWith({ total: 0, count: 0, sources: [], months: [], awards: [], bonuses: [] })).map((s) => s.html).join("");
  expect(html).not.toContain("centred");
  for (const k of ["evaluations", "projects", "exams", "logtime_50", "logtime_80", "wallet", "other", "tigs"]) expect(html).toContain(f.t(`coal.src.${k}`));
});
