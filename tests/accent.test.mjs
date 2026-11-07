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

test("a dark accent stays dark mode in dark mode: what is picked on the band is the page's ground, not a white block", () => {
  for (const hex of ["#1b5971", "#c2301d"]) {
    const { light, dark } = accentTokens(hex);
    assert.equal(dark["--on-accent"], "#ffffff");
    assert.equal(dark["--band-pick"], "#0f1214");
    assert.ok(contrast(dark["--band-pick-ink"], dark["--band-pick"]) >= 4.5);
    assert.equal(light["--band-pick"], light["--on-accent"]);
  }
});

test("a light accent keeps its dark text on the band and its pick, as before", () => {
  const { dark } = accentTokens("#e39f0b");
  assert.equal(dark["--band-pick"], dark["--on-accent"]);
  assert.equal(dark["--band-pick-ink"], dark["--accent"]);
});

test("lightened for a dark page, a colour keeps its hue and saturation instead of going grey", () => {
  const sat = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const hi = Math.max(r, g, b), lo = Math.min(r, g, b); return (hi - lo) / (1 - Math.abs(hi + lo - 1)); };
  const { dark } = accentTokens("#1b5971");
  assert.ok(contrast(dark["--accent-ink"], "#0f1214") >= 4.5);
  assert.ok(sat(dark["--accent-ink"]) > 0.5, dark["--accent-ink"]);
  assert.ok(sat(dark["--accent-data"]) > 0.5, dark["--accent-data"]);
});

test("the accent's rules over live panels: the raw colour in light, the data colour in dark", () => {
  const { light, dark } = accentTokens("#1b5971");
  assert.equal(light["--accent-line"], light["--accent"]);
  assert.equal(dark["--accent-line"], dark["--accent-data"]);
});

test("a coalition's colour stays apart from the charts' red and green", () => {
  const { light, dark } = accentTokens("#c2301d");
  assert.notEqual(light["--accent-data"], "#c2301d");
  assert.ok(contrast(light["--accent-data"], "#c2402f") > 1.3, light["--accent-data"]);
  assert.equal(light["--accent"], "#c2301d");
  assert.equal(accentTokens("#1b5971").light["--accent-data"], "#1b5971");
  assert.equal(accentTokens("#e39f0b").dark["--accent-data"], "#e39f0b");
  assert.ok(dark["--accent-data"]);
});
