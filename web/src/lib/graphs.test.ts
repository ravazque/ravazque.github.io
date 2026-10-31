import { expect, test } from "vitest";
import { bubbleSpacing, bubbles, calendar, pack } from "./graphs";
import { Fmt } from "../fmt";

const cell = { x: 200, y: 200, left: 0, right: 400, top: 0, bottom: 400 };
const bubble = (i: number, r: number) => ({ login: `p${i}`, group: "g", dir: "received", count: 1, r, p: {}, x: 0, y: 0 }) as any;

test("a group clusters with its biggest bubble in the middle and none overlapping", () => {
  const bs = [bubble(0, 8), bubble(1, 30), bubble(2, 12), bubble(3, 8), bubble(4, 20), bubble(5, 10)];
  pack(bs, cell as any);
  const big = bs[1], d = (b: any) => Math.hypot(b.x - cell.x, b.y - 214);
  expect(d(big)).toBeLessThan(1);
  for (const b of bs) expect(d(b)).toBeGreaterThanOrEqual(d(big));
  for (const a of bs) for (const b of bs) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r + 2.9);
});

test("every calendar year is a full rectangle of weeks, the days outside the data drawn as empty squares", () => {
  const f = { t: (k: string) => k, day: (d: string) => d, num: (v: number) => String(v), months: Array(12).fill("m") } as any;
  const html = calendar(f, ["2025-12-30", "2025-12-31", "2026-01-01"], [2, 0, 3]);
  const years = html.split('class="cal-year"').slice(1);
  // 2025 starts on a Wednesday (53 weeks), 2026 on a Thursday (53 weeks): 7 cells a week, data or not
  for (const y of years) expect((y.match(/class="d[ "]/g) || []).length).toBe(53 * 7);
  expect(years[0]).toContain("--cols:53");
  expect((html.match(/data-tip=/g) || []).length).toBe(3);
});

test("crowded groups get zones tall enough that no bubble overlaps another, at every width", () => {
  const people = [["rank-05", 5], ["rank-06", 2], ["outer-core", 35], ["alumni", 19], ["blackholed", 36], ["staff", 2]]
    .flatMap(([g, n]) => Array.from({ length: n as number }, (_, i) => ({ login: `${g}-${i}`, group: g as string, received: i % 7 ? 1 : 1 + (i % 5), given: 0 })));
  for (const width of [420, 840, 1200]) {
    const svg = bubbles(new Fmt("en"), people, "received", { width, href: () => "#" });
    const at = [...svg.matchAll(/translate\(([\d.]+),([\d.]+)\)"><title>[^<]*<\/title><circle class="core" r="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));
    expect(at.length).toBe(people.length);
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) {
      const [x1, y1, r1] = at[i], [x2, y2, r2] = at[j];
      expect(Math.hypot(x1 - x2, y1 - y2), `${width}: ${i} and ${j}`).toBeGreaterThanOrEqual(r1 + r2 + bubbleSpacing().gap - 0.2);
    }
  }
});
