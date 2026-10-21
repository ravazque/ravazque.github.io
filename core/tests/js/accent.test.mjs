import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { accentTokens, contrast, INTRA } = require("../../core42/frontend/accent.js");

for (const hex of ["#e39f0b", "#ffe9a8", "#0b1a40", "#7a1f2b", "#3ecf8e", "#ffffff", "#000000", null, "not-a-colour"]) {
  test(`accent ${hex} meets contrast`, () => {
    const { light, dark } = accentTokens(hex);
    assert.ok(contrast(light["--amber-ink"], "#f4f5f7") >= 4.5);
    assert.ok(contrast(light["--amber-data"], "#ffffff") >= 3);
    assert.ok(contrast(dark["--amber-ink"], "#12161d") >= 4.5);
    assert.ok(contrast(dark["--amber-data"], "#1a1f28") >= 3);
    assert.ok(contrast(light["--on-amber"], light["--amber"]) >= 4.5);
    assert.equal(light["--ramp-hi"], light["--amber-data"]);
    assert.ok(contrast(light["--amber-rail"], "#1e2430") >= 4.5);
    assert.ok(contrast(dark["--amber-rail"], "#0b0e13") >= 4.5);
    // the rail's own fill (active period, active page): a 3:1 mark on the rail, with readable text on it
    assert.ok(contrast(light["--rail-accent"], "#1e2430") >= 3);
    assert.ok(contrast(dark["--rail-accent"], "#0b0e13") >= 3);
    assert.ok(contrast(light["--on-rail-accent"], light["--rail-accent"]) >= 4.5);
    assert.ok(contrast(dark["--on-rail-accent"], dark["--rail-accent"]) >= 4.5);
  });
}

test("the backgrounds come from the page's own tokens when given", () => {
  const black = {surface: "#000000", ground: "#000000", rail: "#ffffff"};
  const { light } = accentTokens("#3f5a73", {light: black, dark: black});
  assert.ok(contrast(light["--amber-ink"], "#000000") >= 4.5);
  assert.ok(contrast(light["--amber-rail"], "#ffffff") >= 4.5);
});

test("null and invalid fall back to the intra blue, the default accent", () => {
  assert.equal(INTRA, "#00babc");
  assert.equal(accentTokens(null).light["--amber"], INTRA);
  assert.equal(accentTokens("not-a-colour").light["--amber"], INTRA);
});

test("contrast of black on white is 21", () => assert.equal(Math.round(contrast("#000000", "#ffffff")), 21));
