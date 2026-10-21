import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { filterTrack, myRank } = require("../../core42/frontend/report.js");

const projects = [{ name: "C 00", track: "piscine" }, { name: "Libft", track: "common-core" }, { name: "scop", track: "outer-core" }];

test("student is common core plus outer core", () => assert.deepEqual(filterTrack(projects, "student").map((p) => p.name), ["Libft", "scop"]));
test("one track at a time", () => {
  assert.deepEqual(filterTrack(projects, "piscine").map((p) => p.name), ["C 00"]);
  assert.deepEqual(filterTrack(projects, "outer-core").map((p) => p.name), ["scop"]);
});

const q = (name, validated = "2025-01-01 10:00") => ({ name, validated });
test("rank is the one being worked on", () => {
  assert.equal(myRank({ cursus: [{ name: "42cursus", grade: "Learner" }], quests: [q("Common Core Rank 02"), q("Common Core Rank 00")] }), "rank-03");
  assert.equal(myRank({ cursus: [{ name: "42cursus", grade: "Learner" }], quests: [] }), "rank-00");
  assert.equal(myRank({ cursus: [{ name: "42cursus", grade: "Transcender" }], quests: [] }), "outer-core");
  assert.equal(myRank({ cursus: [{ name: "42cursus", grade: "Learner" }], quests: [q("Common Core")] }), "outer-core");
  assert.equal(myRank({ cursus: [{ name: "42cursus", grade: "Alumni" }], quests: [] }), "alumni");
  assert.equal(myRank({ cursus: [{ name: "C Piscine", grade: "Pisciner" }], quests: [] }), null);
  assert.equal(myRank({ cursus: [{ name: "42cursus" }], quests: [q("Common Core Rank 04", null)] }), "rank-00");
});

const { moreBelow } = require("../../core42/frontend/report.js");
test("a scroll box hints at more content only while rows remain below", () => {
  assert.equal(moreBelow({ scrollTop: 0, clientHeight: 440, scrollHeight: 2600 }), true);
  assert.equal(moreBelow({ scrollTop: 2160, clientHeight: 440, scrollHeight: 2600 }), false);
  assert.equal(moreBelow({ scrollTop: 0, clientHeight: 440, scrollHeight: 440 }), false);
  assert.equal(moreBelow({ scrollTop: 2158, clientHeight: 440, scrollHeight: 2600 }), false);
});

const { stageLabel } = require("../../core42/frontend/report.js");
const { projectView, groupProjects, toCSV } = require("../../core42/frontend/projects.js");
const tt = (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, x) => v[x]);

test("the identity shows the cursus stage, never the coalition rank", () => {
  const quests = (n) => Array.from({ length: n }, (_, i) => ({ name: `Common Core Rank 0${i}`, validated: "2025-01-01" }));
  assert.equal(stageLabel({ cursus: [{ name: "42cursus", grade: "Transcender" }], quests: [] }, tt), "groups.outer-core");
  assert.equal(stageLabel({ cursus: [{ name: "42cursus", grade: null }], quests: quests(4) }, tt), "groups.rank-04");
  assert.equal(stageLabel({ cursus: [{ name: "C Piscine", grade: "Pisciner" }], quests: [] }, tt), "home.no_cursus");
});

const P = [
  { name: "Libft", track: "common-core", group: "rank-00", mark: 125, validated: true, status: "finished", marked: "2024-10-01 10:00", registered: "2024-09-16 10:00", xp_earned: 578 },
  { name: "minishell", track: "common-core", group: "rank-03", mark: 101, validated: true, status: "finished", marked: "2025-03-02 10:00", registered: "2025-01-10 10:00", xp_earned: 2850 },
  { name: "push_swap", track: "common-core", group: "rank-02", mark: 84, validated: true, status: "finished", marked: "2025-01-02 10:00", registered: "2024-12-01 10:00", xp_earned: 1000 },
  { name: "Exam Rank 02", track: "common-core", group: "rank-02", mark: 0, validated: false, status: "finished", marked: "2024-11-01 10:00", registered: "2024-11-01 10:00", xp_earned: 0 },
  { name: "scop", track: "outer-core", group: "outer-core", mark: null, validated: false, status: "in_progress", marked: null, registered: "2026-10-01 10:00", xp_earned: 0 },
  { name: "C Piscine Shell 00", track: "piscine", group: "piscine", mark: 60, validated: true, status: "finished", marked: "2024-07-03 10:00", registered: "2024-07-01 10:00", xp_earned: 0 },
];

test("the project view filters by track, name, mark and year", () => {
  const names = (o) => projectView(P, { track: "student", search: "", marks: "all", year: "all", ...o }).map((p) => p.name);
  assert.deepEqual(names({}), ["Libft", "minishell", "push_swap", "Exam Rank 02", "scop"]);
  assert.deepEqual(names({ track: "piscine" }), ["C Piscine Shell 00"]);
  assert.equal(names({ track: "all" }).length, 6);
  assert.deepEqual(names({ search: "SHELL", track: "all" }), ["minishell", "C Piscine Shell 00"]);
  assert.deepEqual(names({ marks: "bonus" }), ["Libft", "minishell"]);
  assert.deepEqual(names({ marks: "max" }), ["Libft"]);
  assert.deepEqual(names({ marks: "failed" }), ["Exam Rank 02"]);
  assert.deepEqual(names({ year: "2025" }), ["minishell", "push_swap"]);
});

test("projects group by Common Core rank, then Outer Core, then Piscine", () => {
  assert.deepEqual(groupProjects(P).map((g) => [g.group, g.rows.length]),
    [["rank-00", 1], ["rank-02", 2], ["rank-03", 1], ["outer-core", 1], ["piscine", 1]]);
});

test("CSV export quotes what needs quoting", () => {
  const csv = toCSV([{ name: 'Exam, "final"', mark: 100 }, { name: "Libft", mark: null }], [{ k: "name", t: "Project" }, { k: "mark", t: "Mark" }]);
  assert.equal(csv, 'Project,Mark\n"Exam, ""final""",100\nLibft,\n');
});

test("pages without extras (the logtime page) show no stage instead of failing", () => {
  assert.equal(myRank(undefined), null);
  assert.equal(stageLabel(undefined, tt), "");
});

test("only plain hex colours reach a style attribute", () => {
  const { safeColor } = require("../../core42/frontend/report.js");
  assert.equal(safeColor("#E39F0B"), "#E39F0B");
  assert.equal(safeColor("red;background:url(x)"), "var(--neutral)");
  assert.equal(safeColor(null), "var(--neutral)");
});
