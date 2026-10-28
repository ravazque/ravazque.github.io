"use strict";
// Accent tokens from the chosen accent: the intra blue by default, or the signed-in user's coalition colour.
// The raw colour fills large areas; every token that carries text or data is nudged toward black or white
// until it meets WCAG contrast against the page's own backgrounds (read from ui.json's tokens when available).

const INTRA = "#00babc";  // the intra's turquoise blue: the default accent
const FALLBACK = INTRA;
const BG = {  // ui.json's defaults, used when the page's tokens cannot be read (tests, no CSS)
  light: {surface: "#f7f8f8", ground: "#f7f8f8", ink: "#111417"},
  dark: {surface: "#0f1214", ground: "#0f1214"},
};
const TEXT = 4.5, MARKS = 3;

function parse(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mixRgb = (a, b, w) => a.map((v, i) => v + (b[i] - v) * w);  // w = share of b

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const la = luminance(parse(a)), lb = luminance(parse(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Mix toward black or white in 4% steps until the colour passes `ok`; `toward` defaults to away from the background
function mixUntil(rgb, toward, ok) {
  const target = toward === "black" ? [0, 0, 0] : [255, 255, 255];
  for (let w = 0; w <= 1.0001; w += 0.04) {
    const c = toHex(mixRgb(rgb, target, Math.min(w, 1)));
    if (ok(c)) return c;
  }
  return toHex(target);
}
const away = (backgrounds) => backgrounds.reduce((a, b) => a + luminance(parse(b)), 0) / backgrounds.length > 0.18 ? "black" : "white";
const reach = (rgb, backgrounds, ratio) => mixUntil(rgb, away(backgrounds), (c) => backgrounds.every((bg) => contrast(c, bg) >= ratio));

// Text on a filled accent: dark ink when it reads, otherwise white; darken the fill if neither does
function onFill(rgb, ink) {
  const fill = toHex(rgb);
  if (contrast(ink, fill) >= TEXT) return {fill, on: ink};
  if (contrast("#ffffff", fill) >= TEXT) return {fill, on: "#ffffff"};
  return {fill: mixUntil(rgb, "black", (c) => contrast(c, "#ffffff") >= TEXT), on: "#ffffff"};
}

function accentTokens(hex, bg = BG) {
  const rgb = parse(hex) || parse(FALLBACK);
  const L = {...BG.light, ...(bg.light || {})}, Dk = {...BG.dark, ...(bg.dark || {})};
  const {fill, on} = onFill(rgb, L.ink);
  const lightData = reach(rgb, [L.surface, L.ground], MARKS);
  const darkData = reach(rgb, [Dk.surface, Dk.ground], MARKS);
  return {
    light: {
      "--accent": fill, "--on-accent": on,
      "--accent-data": lightData, "--ramp-hi": lightData,
      "--accent-ink": reach(rgb, [L.surface, L.ground], TEXT),
      "--ramp-lo": toHex(mixRgb([255, 255, 255], rgb, 0.22)),
    },
    dark: {
      "--accent": fill, "--on-accent": on,
      "--accent-data": darkData, "--ramp-hi": darkData,
      "--accent-ink": reach(rgb, [Dk.surface, Dk.ground], TEXT),
      "--ramp-lo": toHex(mixRgb(parse(Dk.ground), rgb, 0.3)),
    },
  };
}

// The page's own ground and surface in both themes, read from ui.css (switching data-theme for a moment:
// a style recalculation, no paint). Missing or unreadable values fall back to BG.
function pageBackgrounds(doc) {
  const root = doc.documentElement, saved = root.dataset.theme, out = {};
  for (const theme of ["light", "dark"]) {
    root.dataset.theme = theme;
    const cs = doc.defaultView.getComputedStyle(root);
    out[theme] = Object.fromEntries(["surface", "ground"].map((k) => [k, cs.getPropertyValue(`--${k}`).trim()]).filter(([, v]) => parse(v)));
  }
  if (saved) root.dataset.theme = saved; else delete root.dataset.theme;
  return out;
}

function applyAccent(hex, doc = typeof document !== "undefined" ? document : null) {
  if (!doc) return;
  const {light, dark} = accentTokens(hex, pageBackgrounds(doc));
  const block = (vars) => Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(" ");
  let style = doc.getElementById("accent");
  if (!style) { style = doc.createElement("style"); style.id = "accent"; }
  style.textContent = `:root { ${block(light)} }\n` +
    `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${block(dark)} } }\n` +
    `:root[data-theme="dark"] { ${block(dark)} }`;
  doc.head.appendChild(style);  // last in <head>, so it wins over ui.css and report.css
}

if (typeof module !== "undefined" && module.exports) module.exports = {accentTokens, applyAccent, contrast, INTRA};
if (typeof window !== "undefined") Object.assign(window, {accentTokens, applyAccent});
