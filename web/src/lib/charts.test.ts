import { expect, test } from "vitest";
import { BAD, S1, hbars, lines, qline, tightAxis, vbars } from "./charts";
import { Fmt } from "../fmt";

test("a negative value still draws its bar, as long as its size and in red", () => {
  const html = hbars(new Fmt("en"), ["Evaluations", "Other"], [["Points", [100, -300], S1]], { label: "Points" });
  const bars = [...html.matchAll(/<i style="width:([\d.]+)%;background:([^;"]+)/g)].map((m) => ({ width: Number(m[1]), color: m[2] }));
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

test("a running-total line: a dot per label joined by a line, each label's strip with its tip", () => {
  const f = new Fmt("en");
  const html = qline(f, ["Q1 26", "Q2 26", "Q3 26"], [4, 2, 7], { label: "Balance", color: "black", tips: ["a", "b", "c"] });
  expect(html.match(/class="ch-col ql"/g)?.length).toBe(3);
  // the dots apart from the line, as in XP per month: they fade in once it is drawn
  expect(html.match(/class="ch-dot"/g)?.length).toBe(3);
  expect(html).not.toContain("ch-dots");
  expect([...html.matchAll(/class="ch-dot" style="--d:([\d.]+)/g)].map((m) => m[1])).toEqual(["0.000", "0.500", "1.000"]); // left to right
  expect(html).toContain('data-tip="b"');
  expect(html).not.toContain("ch-zero"); // nothing under 0: no zero line of its own
});

test("a stack's parts grow one after the other: each one present gets its turn, from the bottom up", () => {
  const html = vbars(new Fmt("en"), ["Jan"], [["a", [3], "red"], ["b", [0], "blue"], ["c", [2], "green"], ["d", [1], "grey"]], { label: "x", stacked: true });
  expect([...html.matchAll(/--k:(\d)/g)].map((m) => m[1])).toEqual(["0", "1", "2"]); // the empty one takes no turn
});

test("a line chart's month labels are real months, counted back from the last, which always shows at the edge", () => {
  const f = new Fmt("en"), at = (d: string) => Date.parse(`${d}T12:00:00Z`);
  const labels = (html: string) => [...html.matchAll(/<span( class="end")? style="left:[\d.]+%">([^<]+)<\/span>/g)].map((m) => (m[1] ? `${m[2]}|end` : m[2]));
  const html = lines(f, [["a", [{ x: at("2025-10-03"), y: 1 }, { x: at("2026-09-20"), y: 9 }], "red"]], { label: "x", to: at("2026-11-10") });
  const xs = labels(html);
  expect(xs.at(-1)).toBe("Nov 26|end"); // the line reaches the report's day, and so does the axis
  expect(new Set(xs).size).toBe(xs.length); // no month twice
  expect(xs).toEqual(["Nov 25", "Jan 26", "Mar 26", "May 26", "Jul 26", "Sep 26", "Nov 26|end"]); // every other month, from the end
  const plain = labels(lines(f, [["a", [{ x: at("2026-01-10"), y: 1 }, { x: at("2026-04-20"), y: 3 }], "red"]], { label: "x" }));
  expect(plain).toEqual(["Jan 26", "Feb 26", "Mar 26", "Apr 26|end"]);
});

test("a balance's axis counts in whole points: no 12.5 between two balances", () => {
  for (const values of [[3, -7, -22, -24, -2], [0, 1, 2], [4, -1], [0, 37, 180]]) {
    const html = qline(new Fmt("en"), values.map((_, i) => `w${i}`), values, { label: "x", color: "red", tips: values.map(() => "") });
    const ticks = [...html.matchAll(/<span style="bottom:[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.length).toBeLessThan(8);
    expect(ticks.filter((t) => /[.,]\d/.test(t))).toEqual([]);
    expect(ticks).toContain("0");
  }
});

test("a long line chart names months evenly, counted back from the month the data ends in: no label of the margin after it", () => {
  const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
  const html = lines(new Fmt("en"), [["a", [{ x: day("2022-03-10"), y: 1 }, { x: day("2026-04-20"), y: 9 }], "#000"]], { label: "x", to: day("2026-11-12") });
  const months = html.slice(html.indexOf('class="ch-months"'));
  const at = [...months.matchAll(/left:([\d.]+)%">([^<]+)</g)].map((m) => [+m[1], m[2]] as [number, string]);
  expect(at.at(-1)![1]).toBe("Nov 26");
  const gaps = at.slice(1).map(([x], i) => x - at[i][0]);
  expect(Math.min(...gaps)).toBeGreaterThan(0.8 * Math.max(...gaps)); // the last two were 7 months apart among gaps of 9
  expect(new Set(at.map(([, n]) => n)).size).toBe(at.length);
});
