import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { accentTokens, contrast, INTRA } = require("../shared/accent.js");

for (const hex of ["#e39f0b", "#ffe9a8", "#0b1a40", "#7a1f2b", "#3ecf8e", "#ffffff", "#000000", null, "not-a-colour"]) {
  test(`accent ${hex} meets contrast`, () => {
    const { light, dark } = accentTokens(hex);
    assert.ok(contrast(light["--accent-ink"], "#f7f8f8") >= 4.5);
    assert.ok(contrast(light["--accent-data"], "#f7f8f8") >= 3);
    assert.ok(contrast(dark["--accent-ink"], "#0f1214") >= 4.5);
    assert.ok(contrast(dark["--accent-data"], "#0f1214") >= 3);
    assert.equal(light["--ramp-hi"], light["--accent-data"]);
    // the band is the accent fill in both themes, with its text readable on it
    assert.ok(contrast(light["--on-accent"], light["--accent"]) >= 4.5);
    assert.ok(contrast(dark["--on-accent"], dark["--accent"]) >= 4.5);
    assert.equal(light["--amber-rail"], undefined);
  });
}

test("the backgrounds come from the page's own tokens when given", () => {
  const black = {surface: "#000000", ground: "#000000"};
  const { light } = accentTokens("#3f5a73", {light: black, dark: black});
  assert.ok(contrast(light["--accent-ink"], "#000000") >= 4.5);
});

test("null and invalid fall back to the intra blue, the default accent", () => {
  assert.equal(INTRA, "#00babc");
  assert.equal(accentTokens(null).light["--accent"], INTRA);
  assert.equal(accentTokens("not-a-colour").light["--accent"], INTRA);
});

test("contrast of black on white is 21", () => assert.equal(Math.round(contrast("#000000", "#ffffff")), 21));
