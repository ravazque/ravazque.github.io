import { expect, test } from "vitest";
import { pack } from "./graphs";

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
