import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { prepareNetwork, linkWidth } = require("../../static/network.js");

test("both directions between two people become one line with both counts", () => {
  const net = prepareNetwork({ nodes: [{ login: "me", group: "me" }, { login: "ana", group: "rank-05" }, { login: "bob", group: "outer-core" }],
    links: [{ source: "ana", target: "bob", count: 2 }, { source: "bob", target: "ana", count: 1 }, { source: "bob", target: "me", count: 3 }] });
  assert.deepEqual(net.links, [{ source: "ana", target: "bob", ab: 2, ba: 1, count: 3 }, { source: "bob", target: "me", ab: 3, ba: 0, count: 3 }]);
  assert.deepEqual(net.nodes.map((n) => [n.login, n.degree]), [["me", 3], ["ana", 3], ["bob", 6]]);
});

test("lines thicken with the number of evaluations, gently", () => {
  assert.equal(linkWidth(1), 1.5);
  assert.ok(linkWidth(10) > linkWidth(2) && linkWidth(10) <= 6);
});
