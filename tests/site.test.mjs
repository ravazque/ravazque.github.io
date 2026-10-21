import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { pickLang, levelParts, seatFill, stageLabel, fmtDate, esc, makeT } = require("../site.js");

test("Spanish browsers get Spanish, everyone else English", () => {
  assert.equal(pickLang(["es-ES", "en"]), "es");
  assert.equal(pickLang(["en-GB", "es"]), "en");
  assert.equal(pickLang([]), "en");
});

test("a level splits into the whole level and the way to the next", () => {
  assert.deepEqual(levelParts(16.9), { whole: 16, frac: 0.9 });
  assert.deepEqual(levelParts(4.67), { whole: 4, frac: 0.67 });
  assert.deepEqual(levelParts(0), { whole: 0, frac: 0 });
});

test("a skill level lights one seat per level and part of the next", () => {
  const cells = seatFill(13.36, 20);
  assert.equal(cells.length, 20);
  assert.deepEqual(cells.slice(0, 13), Array(13).fill(1));
  assert.equal(cells[13], 0.36);
  assert.deepEqual(cells.slice(14), Array(6).fill(0));
  assert.deepEqual(seatFill(25, 4), [1, 1, 1, 1]);
});

test("stages read like the dashboard", () => {
  const t = makeT("en");
  assert.equal(stageLabel("rank-03", t), "Common Core · Rank 03");
  assert.equal(stageLabel("outer-core", t), "Outer Core");
  assert.equal(stageLabel("alumni", t), "Alumni");
  assert.equal(stageLabel(null, t), "");
  assert.equal(stageLabel("rank-03", makeT("es")), "Common Core · Rango 03");
});

test("dates are written for the reader's language", () => {
  assert.equal(fmtDate("2025-03-02", "en"), "2 Mar 2025");
  assert.equal(fmtDate("2025-03-02", "es"), "2 mar 2025");
  assert.equal(fmtDate("2024-07", "en"), "July 2024");
  assert.equal(fmtDate("", "en"), "");
});

test("text from the data files is escaped", () => assert.equal(esc(`<b a="1">&'`), "&lt;b a=&quot;1&quot;&gt;&amp;&#39;"));

const { snapshotProjects, pick } = require("../site.js");

test("published projects map onto the shared project view", () => {
  const rows = snapshotProjects({ projects: { list: [{ name: "Libft", track: "common-core", group: "rank-00", mark: 125, xp: 578, validated: "2024-10-01" }] } });
  assert.deepEqual(rows, [{ name: "Libft", track: "common-core", group: "rank-00", mark: 125, xp_earned: 578, validated: true,
    status: "finished", marked: "2024-10-01", date: "2024-10-01" }]);
  assert.deepEqual(snapshotProjects(null), []);
});

test("bilingual CV fields fall back to English", () => {
  assert.equal(pick({ en: "a", es: "b" }, "es"), "b");
  assert.equal(pick({ en: "a" }, "es"), "a");
  assert.equal(pick("plain", "es"), "plain");
  assert.equal(pick(null, "en"), "");
});
