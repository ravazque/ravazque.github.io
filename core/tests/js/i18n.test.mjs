import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { setDict, t } = require("../../core42/frontend/report.js");

test("t fills placeholders and picks plural", () => {
  setDict({ "seats.computers": { one: "{count} computer", other: "{count} computers" }, hi: "Hi {name}" });
  assert.equal(t("hi", { name: "Ann" }), "Hi Ann");
  assert.equal(t("seats.computers", { count: 1 }), "1 computer");
  assert.equal(t("seats.computers", { count: 148 }), "148 computers");
  assert.equal(t("missing.key"), "missing.key");
});

test("unknown placeholders stay visible", () => {
  setDict({ x: "a {b} c" });
  assert.equal(t("x"), "a {b} c");
});
