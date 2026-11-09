import { expect, test } from "vitest";
import { BAD, S1, hbars, tightAxis, vbars } from "./charts";
import { Fmt } from "../fmt";

test("a negative value still draws its bar, as long as its size and in red", () => {
  const html = hbars(new Fmt("en"), ["Evaluations", "Other"], [["Points", [100, -300], S1]], { label: "Points" });
  const bars = [...html.matchAll(/<i style="width:([\d.]+)%;background:([^"]+)"/g)].map((m) => ({ width: Number(m[1]), color: m[2] }));
  expect(bars).toHaveLength(2);
  expect(bars[1].color).toBe(BAD);
  expect(bars[1].width).toBeCloseTo(3 * bars[0].width, 1);
});
test("a tight axis ends at the first tick over the highest value", () => {
  expect(tightAxis(28000)).toEqual({ top: 37500, steps: 3 });
  expect(tightAxis(17500)).toEqual({ top: 20000, steps: 4 });
  expect(tightAxis(20000)).toEqual({ top: 20000, steps: 4 });
  expect(tightAxis(0)).toEqual({ top: 1, steps: 4 });
});

test("Points per month's scale: up to 37.5k for a best month of 28k, not 50k", () => {
  const f = new Fmt("en"), series: [string, number[], string][] = [["Points", [12000, 28000], "red"]];
  const tight = vbars(f, ["Jan", "Feb"], series, { label: "x", stacked: true, tight: true });
  expect(tight).toContain("37.5k");
  expect(tight).not.toContain("50k");
  expect(vbars(f, ["Jan", "Feb"], series, { label: "x", stacked: true })).toContain("50k");
});

test("the last label of many columns (months) spills left, not off the chart; a few wide columns keep it under their bars", () => {
  const f = new Fmt("en"), months = Array.from({ length: 12 }, (_, i) => `M${i}`);
  expect(vbars(f, months, [["a", months.map(() => 1), "red"]], { label: "x" })).toContain('class="ch-x edge"');
  expect(vbars(f, ["c1", "c2", "not logged"], [["a", [1, 2, 3], "red"]], { label: "x" })).toContain('class="ch-x"');
});
