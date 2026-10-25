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

test("a grouped table sorts inside each group and keeps the group headers in place", () => {
  const { sortBodies } = require("../../static/dash.js");
  const head = (name) => ({name, classList: {contains: (c) => c === "group"}, querySelectorAll: () => []});
  const body = (v) => ({...row(v), name: v, classList: {contains: () => false}});
  const bodies = [head("rank-00"), body("3"), body("1"), head("rank-01"), body("9"), body("2"), body("5")];
  assert.deepEqual(sortBodies(bodies, 0, 1, true).map((b) => b.name), ["rank-00", "1", "3", "rank-01", "2", "5", "9"]);
  assert.deepEqual(sortBodies([body("2"), body("1")], 0, -1, true).map((b) => b.name), ["2", "1"]);
});

test("CSV previews read quoted fields, doubled quotes and line breaks inside quotes", () => {
  const { parseCsv } = require("../../static/dash.js");
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\r\n"two\nlines",3\n'), [["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", "3"]]);
  assert.deepEqual(parseCsv("a,b"), [["a", "b"]]);
  assert.deepEqual(parseCsv(""), []);
});
