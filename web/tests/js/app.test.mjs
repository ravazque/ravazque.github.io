import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { viewFor, fmtWait } = require("../../static/app.js");

test("first extraction shows progress only", () => assert.equal(viewFor({ state: "running" }, false), "progress"));
test("queued first extraction shows progress", () => assert.equal(viewFor({ state: "queued" }, false), "progress"));
test("refresh keeps old report visible", () => assert.equal(viewFor({ state: "queued" }, true), "report+progress"));
test("failure without data is an error view", () => assert.equal(viewFor({ state: "failed" }, false), "error"));
test("failure with data keeps the report", () => assert.equal(viewFor({ state: "failed" }, true), "report"));
test("nothing yet and idle is progress (the job is about to start)", () => assert.equal(viewFor({ state: "none" }, false), "progress"));
test("wait rounds up to minutes", () => assert.equal(fmtWait(61, (k, v) => `${k}:${v.count}`), "refresh.wait:2"));
test("under a minute counts seconds", () => assert.equal(fmtWait(42, (k, v) => `${k}:${v.count}`), "refresh.wait_s:42"));
const { publishState } = require("../../static/app.js");
const NOW = Date.parse("2026-10-18T20:00:00Z");
test("publishing is ready within the hour after an extraction", () =>
  assert.equal(publishState({ state: "done", last: "2026-10-18T19:01:00+00:00" }, NOW), "ready"));
test("publishing waits for a fresh extraction after an hour", () =>
  assert.equal(publishState({ state: "done", last: "2026-10-18T18:59:00+00:00" }, NOW), "stale"));
test("publishing waits while an extraction runs", () =>
  assert.equal(publishState({ state: "running", last: "2026-10-18T19:59:00+00:00" }, NOW), "busy"));
test("no extraction yet is stale", () => assert.equal(publishState({ state: "none" }, NOW), "stale"));
test("nothing stored and the hour not over is a wait view", () => assert.equal(viewFor({ state: "none", next_refresh_in: 600 }, false), "wait"));
