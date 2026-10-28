"use strict";
// Skills radar drawn like the intra's: every skill of the cursus on its own spoke, in the given order, clockwise from
// half a step right of the top, four rings, the levels as one filled shape. Styled by the page's .radar CSS classes.

function radarMax(levels) {
  return Math.max(5, Math.ceil(Math.max(0, ...levels) / 5) * 5);
}

function radarAngle(i, n) {
  return -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / n;
}

function radarPoints(levels, max, {cx, cy, r}) {
  return levels.map((v, i) => {
    const a = radarAngle(i, levels.length), k = Math.max(0, Math.min(1, (v || 0) / max)) * r;
    return {x: cx + k * Math.cos(a), y: cy + k * Math.sin(a)};
  });
}

// items: [{name, level}]; the svg gets a viewBox and is redrawn from scratch
// compact: a smaller circle with shorter label lines, for narrow boxes (the CSS enlarges the text to match)
function drawRadar(svg, items, {name = (s) => s, fmt = (v) => v.toFixed(2), label = "Skills", compact = false} = {}) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const W = compact ? 400 : 560, H = compact ? 380 : 440, cx = W / 2, cy = H / 2, r = 150, n = items.length, wrap = 15;
  const max = radarMax(items.map((s) => s.level));
  const rim = radarPoints(items.map(() => max), max, {cx, cy, r});
  const shape = radarPoints(items.map((s) => s.level), max, {cx, cy, r});
  const lines = (text) => {
    const words = String(text).split(" "), out = [""];
    for (const w of words) (out[out.length - 1] + " " + w).trim().length > wrap && out[out.length - 1] ? out.push(w) : out[out.length - 1] = (out[out.length - 1] + " " + w).trim();
    return out;
  };
  const lh = 15, gap = 4;
  // compact: each spoke ends in its number; the names go in the key the caller draws (radarKey). Otherwise every
  // spoke ends in its name, and labels on each side are pushed apart so neighbours near the poles never overlap.
  const placed = items.map((s, i) => {
    const a = radarAngle(i, n), x = cx + (r + (compact ? 16 : 22)) * Math.cos(a), y = cy + (r + (compact ? 16 : 22)) * Math.sin(a);
    const anchor = Math.cos(a) > 0.08 ? "start" : Math.cos(a) < -0.08 ? "end" : "middle";
    const ls = compact ? [String(i + 1)] : lines(name(s.name));
    const h = ls.length * lh;
    const top = Math.sin(a) < -0.5 && anchor === "middle" ? y - h : Math.sin(a) > 0.5 && anchor === "middle" ? y + 4 : y - h / 2;
    return {x, top, h, anchor, ls};
  });
  if (!compact) for (const side of ["start", "end"]) {
    const col = placed.filter((p) => p.anchor === side).sort((p, q) => p.top - q.top);
    for (let k = 1; k < col.length; k++) col[k].top = Math.max(col[k].top, col[k - 1].top + col[k - 1].h + gap);
  }
  const labels = placed.map((p) => `<text class="label${compact ? " num" : ""}" x="${p.x.toFixed(1)}" y="${(p.top + lh - 3).toFixed(1)}" text-anchor="${p.anchor}">` +
    p.ls.map((l, k) => `<tspan x="${p.x.toFixed(1)}" dy="${k ? lh : 0}">${esc(l)}</tspan>`).join("") + "</text>").join("");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${label}: ${items.map((s) => `${name(s.name)} ${fmt(s.level)}`).join(", ")}`);
  svg.innerHTML =
    [1, 2, 3, 4].map((k) => `<circle class="ring" cx="${cx}" cy="${cy}" r="${(r * k) / 4}"/>`).join("") +
    rim.map((p) => `<line class="spoke" x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}"/>`).join("") +
    `<polygon class="shape" points="${shape.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}"/>` +
    shape.map((p, i) => items[i].level ? `<circle class="dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5"><title>${esc(name(items[i].name))} · ${esc(fmt(items[i].level))}</title></circle>` : "").join("") +
    labels;
}

// The key under a compact radar: number, name and level of each spoke
function radarKey(el, items, {name = (s) => s, fmt = (v) => v.toFixed(2)} = {}) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  el.innerHTML = items.map((s, i) => `<li><span class="k">${i + 1}</span><span class="n">${esc(name(s.name))}</span><span class="v">${esc(fmt(s.level))}</span></li>`).join("");
}

if (typeof module !== "undefined" && module.exports) module.exports = {radarMax, radarPoints, radarAngle, drawRadar, radarKey};
if (typeof window !== "undefined") { window.drawRadar = drawRadar; window.radarKey = radarKey; }
