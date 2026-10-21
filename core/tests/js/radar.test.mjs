import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { radarMax, radarPoints } = require("../../core42/frontend/radar.js");

test("the scale rounds the highest level up to a step of 5, never below 5", () => {
  assert.equal(radarMax([13.36, 2]), 15);
  assert.equal(radarMax([0, 0]), 5);
  assert.equal(radarMax([20]), 20);
});

test("the first axis sits half a step clockwise from the top, like the intra", () => {
  const [first, second] = radarPoints([10, 10, 10, 10], 10, { cx: 0, cy: 0, r: 100 });
  assert.ok(Math.abs(first.x - 70.71) < 0.01 && Math.abs(first.y + 70.71) < 0.01);   // −45°: up and to the right
  assert.ok(Math.abs(second.x - 70.71) < 0.01 && Math.abs(second.y - 70.71) < 0.01); // +45°: down and to the right
});

test("a level of 0 sits on the centre and a full level on the rim", () => {
  const pts = radarPoints([0, 5], 5, { cx: 50, cy: 50, r: 40 });
  assert.deepEqual([Math.round(pts[0].x), Math.round(pts[0].y)], [50, 50]);
  assert.ok(Math.abs(Math.hypot(pts[1].x - 50, pts[1].y - 50) - 40) < 1e-9);
});

test("the compact key lists number, name and level", () => {
  const { radarKey } = require("../../core42/frontend/radar.js");
  const el = { innerHTML: "" };
  radarKey(el, [{ name: "Unix", level: 2.5 }, { name: "Rigor", level: 0 }], { fmt: (v) => v.toFixed(1) });
  assert.equal(el.innerHTML, '<li><span class="k">1</span><span class="n">Unix</span><span class="v">2.5</span></li><li><span class="k">2</span><span class="n">Rigor</span><span class="v">0.0</span></li>');
});
