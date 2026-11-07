import { expect, test } from "vitest";
import { dragScroll } from "./behave";

test("dragging near an edge scrolls that way, faster the closer it gets; the band counts as the top", () => {
  expect(dragScroll(500, 72, 900)).toBe(0);
  expect(dragScroll(860, 72, 900)).toBeGreaterThan(0);
  expect(dragScroll(899, 72, 900)).toBeGreaterThan(dragScroll(860, 72, 900));
  expect(dragScroll(100, 72, 900)).toBeLessThan(0);
  expect(dragScroll(40, 72, 900)).toBeLessThan(dragScroll(100, 72, 900));
  expect(dragScroll(-1, 72, 900)).toBe(0); // the pointer left the window
});
