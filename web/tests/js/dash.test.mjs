import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { sortRows } = require("../../static/dash.js");

const row = (...values) => ({querySelectorAll: () => values.map((v) => ({dataset: {v}}))});

test("numbers sort numerically and empty cells go last either way", () => {
  const rows = [row("10"), row(""), row("9"), row("100")];
  const up = sortRows(rows, 0, 1, true).map((r) => r.querySelectorAll()[0].dataset.v);
  const down = sortRows(rows, 0, -1, true).map((r) => r.querySelectorAll()[0].dataset.v);
  assert.deepEqual(up, ["9", "10", "100", ""]);
  assert.deepEqual(down, ["100", "10", "9", ""]);
});

test("text sorts by the chosen column", () => {
  const rows = [row("x", "beta"), row("y", "alpha")];
  assert.deepEqual(sortRows(rows, 1, 1, false).map((r) => r.querySelectorAll()[1].dataset.v), ["alpha", "beta"]);
});
