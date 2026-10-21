"use strict";
// "Your circle": you in the centre, your 30 closest contacts on a ring, a chord where one evaluated the other.

// a→b and b→a become one line carrying both counts; each node's degree is the evaluations on its lines
function prepareNetwork(net) {
  const pairs = new Map();
  for (const l of net.links || []) {
    const key = [l.source, l.target].sort().join("|");
    const p = pairs.get(key) || {source: l.source, target: l.target, ab: 0, ba: 0};
    if (l.source === p.source) p.ab += l.count; else p.ba += l.count;
    pairs.set(key, p);
  }
  const links = [...pairs.values()].map((p) => ({...p, count: p.ab + p.ba}));
  const degree = {};
  for (const l of links) { degree[l.source] = (degree[l.source] || 0) + l.count; degree[l.target] = (degree[l.target] || 0) + l.count; }
  return {nodes: (net.nodes || []).map((n) => ({...n, degree: degree[n.login] || 0})), links};
}

const linkWidth = (count) => Math.min(6, 1 + count / 2);

if (typeof module !== "undefined" && module.exports) module.exports = {prepareNetwork, linkWidth};

if (typeof window !== "undefined") {
  let drawn = null;
  const cls = (g) => g === "me" ? "me" : g === "outer-core" ? "outer" : g === "alumni" ? "alumni" : /^rank-/.test(g || "") ? "rank" : "none";

  function draw(all) {
    const box = document.getElementById("netBox"), svgEl = document.getElementById("netGraph");
    if (!box || !window.d3) return;
    const net = prepareNetwork(all.network || {});
    const section = document.getElementById("network");
    if (!net.links.length) { section.hidden = !all.network; box.dataset.empty = t("network.empty"); svgEl.innerHTML = ""; return; }
    delete box.dataset.empty;
    const width = box.clientWidth, height = box.clientHeight;
    const svg = d3.select(svgEl).attr("viewBox", `0 0 ${width} ${height}`).attr("width", width).attr("height", height);
    svg.selectAll("*").remove();
    // narrow boxes: smaller nodes and no names around the ring (a tap shows the tooltip)
    const compact = width < 520, k = compact ? 0.6 : 1;
    const radius = (n) => (n.group === "me" ? 16 : 6 + Math.min(10, Math.sqrt(n.degree) * 1.4)) * k;
    // a ring: you in the centre, everyone else on a circle ordered by group, evaluations as chords between them
    const order = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06", "outer-core", "alumni", "no-cursus"];
    const others = net.nodes.filter((n) => n.group !== "me")
      .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || b.degree - a.degree);
    const cx = width / 2, cy = height / 2, R = Math.max(80, Math.min(width, height) / 2 - (compact ? 22 : 70));
    const nodes = [...net.nodes.filter((n) => n.group === "me").map((n) => ({...n, r: radius(n), x: cx, y: cy, a: 0})),
      ...others.map((n, i) => { const a = -Math.PI / 2 + 2 * Math.PI * i / others.length;
        return {...n, r: radius(n), a, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a)}; })];
    const at = Object.fromEntries(nodes.map((n) => [n.login, n]));
    const links = net.links.filter((l) => at[l.source] && at[l.target]);
    const link = svg.append("g").attr("class", "net-links").selectAll("path").data(links).join("path")
      .attr("stroke-width", (l) => linkWidth(l.count))
      // chords bend toward the centre, so the ring stays readable even with many lines
      .attr("d", (l) => { const a = at[l.source], b = at[l.target];
        return `M${a.x},${a.y} Q${(a.x + b.x) / 2 * 0.5 + cx * 0.5},${(a.y + b.y) / 2 * 0.5 + cy * 0.5} ${b.x},${b.y}`; });
    const node = svg.append("g").attr("class", "net-nodes").selectAll("g").data(nodes).join("g")
      .attr("class", (n) => `net-node ${cls(n.group)}`).attr("data-cell", "").attr("transform", (n) => `translate(${n.x},${n.y})`)
      .attr("data-tip", (n) => n.group === "me" ? n.login : `${n.login} · ${t(`groups.${n.group}`)} · ${t("network.tip", {count: n.degree, n: n.degree})}`)
      .attr("role", "img").attr("aria-label", function () { return this.getAttribute("data-tip"); });
    node.append("circle").attr("r", (n) => n.r);
    node.filter((n) => n.group !== "me" && !compact).append("text")
      .attr("x", (n) => (n.r + 6) * Math.cos(n.a)).attr("y", (n) => (n.r + 6) * Math.sin(n.a) + 4)
      .attr("text-anchor", (n) => Math.cos(n.a) > 0.15 ? "start" : Math.cos(n.a) < -0.15 ? "end" : "middle")
      .text((n) => n.login);
    node.filter((n) => n.group === "me").append("text").attr("y", (n) => n.r + 18).attr("text-anchor", "middle").text((n) => n.login);
    // hovering or focusing someone keeps only their lines in view
    const focus = (login) => {
      svgEl.classList.toggle("focused", !!login);
      link.classed("hl", (l) => !!login && (l.source === login || l.target === login));
    };
    node.on("mouseenter focus", (_, n) => focus(n.login)).on("mouseleave blur", () => focus(null));
    svgEl.dataset.roving = ""; svgEl.setAttribute("role", "group");
    svgEl.querySelectorAll("[data-cell]").forEach((c, i) => { c.tabIndex = i ? -1 : 0; });
  }

  document.addEventListener("report:rendered", (ev) => {
    if (drawn === ev.detail.all) return;  // the network does not change with the period
    drawn = ev.detail.all;
    draw(ev.detail.all);
    const box = document.getElementById("netBox");
    if (box && !box.dataset.watched) {
      box.dataset.watched = "1";
      let w = box.clientWidth;
      new ResizeObserver(() => { if (box.clientWidth !== w) { w = box.clientWidth; draw(drawn); } }).observe(box);
    }
  });
}
