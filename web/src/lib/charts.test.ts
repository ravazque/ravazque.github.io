import { describe, expect, it, test } from "vitest";
import { BAD, S1, hbars, trend } from "./charts";
import { Fmt } from "../fmt";

describe("trend", () => {
  it("draws no negative bar heights (net points can go below zero)", () => {
    const svg = trend([5, -30, 10], { bars: true });
    expect(svg).not.toMatch(/height="-/);
  });
});

test("a negative value still draws its bar, as long as its size and in red", () => {
  const html = hbars(new Fmt("en"), ["Evaluations", "Other"], [["Points", [100, -300], S1]], { label: "Points" });
  const bars = [...html.matchAll(/<i style="width:([\d.]+)%;background:([^"]+)"/g)].map((m) => ({ width: Number(m[1]), color: m[2] }));
  expect(bars).toHaveLength(2);
  expect(bars[1].color).toBe(BAD);
  expect(bars[1].width).toBeCloseTo(3 * bars[0].width, 1);
});
