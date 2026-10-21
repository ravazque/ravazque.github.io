import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { graphNodes, graphLinks, groupCenters, GROUPS } = require("../../static/graph.js");

const nodes = [{ login: "ann", name: "Ann", group: "rank-04", received: 4, given: 1 }, { login: "bob", name: "Bob", group: "no-cursus", received: 0, given: 2 }];

test("received mode keeps only people who corrected me", () => assert.deepEqual(graphNodes(nodes, "received").map((n) => n.login), ["ann"]));
test("given mode keeps only people I corrected", () => assert.deepEqual(graphNodes(nodes, "given").map((n) => n.login), ["ann", "bob"]));
test("mix makes two linked bubbles per two-way person", () => {
  const g = graphNodes(nodes, "mix");
  assert.deepEqual(g.map((n) => n.id), ["ann:received", "ann:given", "bob:given"]);
  assert.deepEqual(graphLinks(g), [{ source: "ann:received", target: "ann:given" }]);
});
test("no links outside mix", () => assert.deepEqual(graphLinks(graphNodes(nodes, "received")), []));
test("radius grows with sqrt of count", () => assert.equal(graphNodes(nodes, "received")[0].r, 16));
test("empty input gives no nodes", () => assert.deepEqual(graphNodes([], "mix"), []));
test("centres follow GROUPS order left to right", () => {
  const c = groupCenters(["alumni", "rank-04", "outer-core", "no-cursus"], 1000, 500);
  assert.ok(c["rank-04"].x < c["outer-core"].x && c["outer-core"].x < c["alumni"].x && c["alumni"].x < c["no-cursus"].x);
  assert.ok(Object.values(c).every((p) => p.x > 0 && p.x < 1000 && p.y > 0 && p.y < 500));
});
test("narrow screens use a two-column grid", () => {
  const c = groupCenters(GROUPS, 360, 900);
  assert.equal(new Set(Object.values(c).map((p) => Math.round(p.x))).size, 2);
});
test("wide screens with more than five groups use two rows", () => {
  const c = groupCenters(GROUPS, 1200, 600);
  assert.equal(new Set(Object.values(c).map((p) => p.y)).size, 2);
  assert.equal(new Set(Object.values(c).map((p) => Math.round(p.x))).size, 5);
});
test("five groups or fewer stay in one row", () => {
  const c = groupCenters(GROUPS.slice(0, 5), 1200, 600);
  assert.equal(new Set(Object.values(c).map((p) => p.y)).size, 1);
});
test("each centre carries the top edge of its cell for the label", () => {
  const c = groupCenters(GROUPS, 1200, 600);
  assert.deepEqual([...new Set(Object.values(c).map((p) => p.top))].sort((a, b) => a - b), [0, 300]);
  assert.ok(Object.values(c).every((p) => p.y > p.top));
});
test("each centre carries its cell's bottom edge for the vertical clamp", () => {
  const c = groupCenters(GROUPS, 1200, 600);
  assert.deepEqual([...new Set(Object.values(c).map((p) => p.bottom))].sort((a, b) => a - b), [300, 600]);
});
test("bigger groups get wider cells in their row", () => {
  const c = groupCenters(["rank-00", "rank-01", "rank-02"], 900, 400, {"rank-00": 100, "rank-01": 100, "rank-02": 1600});
  assert.ok(c["rank-02"].x - c["rank-01"].x > c["rank-01"].x - c["rank-00"].x);
  assert.ok(c["rank-02"].x < 900);
});
test("a tiny group keeps a usable share of its row", () => {
  const c = groupCenters(["rank-00", "rank-05"], 1000, 400, {"rank-00": 1, "rank-05": 1000});
  assert.ok(c["rank-00"].x >= 100);
});
test("a row grows past its share of the height when its bubbles need the room", () => {
  const c = groupCenters(["rank-05"], 400, 300, {"rank-05": 60000});
  assert.ok(c["rank-05"].bottom - c["rank-05"].top >= 60000 * Math.PI / 0.7 / 400);
});
test("cells tile each row from the left edge to the right edge", () => {
  const c = groupCenters(GROUPS, 1200, 600, {"rank-05": 900, "alumni": 4});
  for (const top of new Set(Object.values(c).map((p) => p.top))) {
    const row = Object.values(c).filter((p) => p.top === top);
    assert.equal(Math.min(...row.map((p) => p.left)), 0);
    assert.equal(Math.round(Math.max(...row.map((p) => p.right))), 1200);
    assert.ok(row.every((p) => p.left < p.x && p.x < p.right));
  }
});
