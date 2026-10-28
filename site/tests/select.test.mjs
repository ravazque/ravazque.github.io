import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { selectReducer } = require("../shared/controls.js");

const base = { open: false, index: 0, committed: 0, labels: ["All flags", "Outstanding only", "Negative flags", "Ok only"] };

test("ArrowDown opens, then moves and wraps", () => {
  let s = selectReducer(base, "ArrowDown");
  assert.equal(s.open, true);
  s = selectReducer({ ...s, index: 3 }, "ArrowDown");
  assert.equal(s.index, 0);
});

test("ArrowUp wraps to the last option", () => assert.equal(selectReducer({ ...base, open: true }, "ArrowUp").index, 3));

test("Home and End jump", () => {
  assert.equal(selectReducer({ ...base, open: true, index: 2 }, "Home").index, 0);
  assert.equal(selectReducer({ ...base, open: true }, "End").index, 3);
});

test("typing a letter moves to the next match after the current one", () => {
  const s = selectReducer({ ...base, open: true, index: 0 }, "o");
  assert.equal(s.index, 1);
  assert.equal(selectReducer(s, "o").index, 3);
});

test("Enter commits and closes, Escape restores", () => {
  const moved = { ...base, open: true, index: 2 };
  assert.deepEqual([selectReducer(moved, "Enter").committed, selectReducer(moved, "Enter").open], [2, false]);
  const esc = selectReducer(moved, "Escape");
  assert.deepEqual([esc.index, esc.open, esc.committed], [0, false, 0]);
});
