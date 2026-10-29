import { describe, expect, it } from "vitest";
import { trend } from "./charts";

describe("trend", () => {
  it("draws no negative bar heights (net points can go below zero)", () => {
    const svg = trend([5, -30, 10], { bars: true });
    expect(svg).not.toMatch(/height="-/);
  });
});
