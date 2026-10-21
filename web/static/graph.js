"use strict";
// Connections graph: who corrected the user and whom the user corrected, as bubbles grouped by rank.

const GROUPS = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06", "outer-core", "alumni", "no-cursus"];

function graphNodes(people, mode) {
  const out = [];
  for (const p of people) {
    for (const dir of mode === "mix" ? ["received", "given"] : [mode]) {
      const count = p[dir];
      if (!count) continue;
      out.push({id: mode === "mix" ? `${p.login}:${dir}` : p.login, login: p.login, name: p.name, group: p.group, dir, count,
        r: 6 + 5 * Math.sqrt(count), received: p.received, given: p.given, last: p.last});
    }
  }
  return out;
}

function graphLinks(nodes) {
  const ids = new Set(nodes.map((n) => n.id));
  return nodes.filter((n) => n.dir === "received" && n.id.endsWith(":received") && ids.has(`${n.login}:given`))
    .map((n) => ({source: n.id, target: `${n.login}:given`}));
}

const LABEL_BAND = 28;  // px above each cell's bubbles for its group label

// Non-empty groups in cursus order, row by row: 2 columns on narrow screens, one row for up to 5 groups,
// two rows past that. sizes[group] is the sum of (r + 2)² of its bubbles. Inside a row, a cell's width follows
// the square root of that, never under 35% of the row's widest, so a crowded rank gets room and a tiny one keeps
// space for its label. A row takes its share of the height, or more when its bubbles need it (packed at ~60%).
// Each centre carries its cell's edges: the label sits at the top, bubbles are clamped inside.
function groupCenters(groups, width, height, sizes = {}) {
  const present = GROUPS.filter((g) => groups.includes(g));
  const cols = width < 600 ? 2 : present.length > 5 ? Math.ceil(present.length / 2) : present.length;
  const rows = Math.max(1, Math.ceil(present.length / cols));
  const out = {};
  let top = 0;
  for (let row = 0; row < rows; row++) {
    const members = present.slice(row * cols, (row + 1) * cols);
    const raw = members.map((g) => Math.sqrt(sizes[g] ?? 1));
    const weights = raw.map((w) => Math.max(w, 0.35 * Math.max(...raw)));
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => width * w / total);
    const need = Math.max(...members.map((g, i) => Math.PI * (sizes[g] ?? 1) / 0.6 / widths[i] + LABEL_BAND));
    const bottom = top + Math.max(height / rows, need);
    let left = 0;
    members.forEach((g, i) => {
      out[g] = {x: left + widths[i] / 2, y: (top + LABEL_BAND + bottom) / 2, top, bottom, left, right: left + widths[i]};
      left += widths[i];
    });
    top = bottom;
  }
  return out;
}

if (typeof module !== "undefined" && module.exports) module.exports = {graphNodes, graphLinks, groupCenters, GROUPS};

if (typeof window !== "undefined") {
  let state = {mode: "received", period: null, all: null};
  const positions = new Map();
  let sim;
  const initials = (s) => String(s || "?").split(/[\s._-]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  function draw() {
    const box = document.getElementById("graphBox");
    if (!box || !window.d3 || !state.all) return;
    const people = (state.all.connections || {})[state.period] || [];
    const nodes = graphNodes(people, state.mode);
    const svg = d3.select("#graph");
    document.getElementById("graphEmpty").hidden = nodes.length > 0;
    svg.attr("hidden", nodes.length ? null : "");
    renderTable(people);
    if (!nodes.length) { if (sim) sim.stop(); return; }

    box.style.height = "";  // back to the ui.json height before measuring; crowded rows may extend it below
    const width = box.clientWidth;
    const sizes = {};
    for (const n of nodes) sizes[n.group] = (sizes[n.group] || 0) + (n.r + 2) ** 2;
    const centers = groupCenters(Object.keys(sizes), width, box.clientHeight, sizes);
    const height = Math.max(box.clientHeight, ...Object.values(centers).map((c) => Math.ceil(c.bottom)));
    if (height > box.clientHeight) box.style.height = `${height}px`;
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", width).attr("height", height);
    for (const n of nodes) {
      const prev = positions.get(n.id) || positions.get(n.login);
      n.x = prev?.x ?? centers[n.group].x + (Math.random() - 0.5) * 40;
      n.y = prev?.y ?? centers[n.group].y + (Math.random() - 0.5) * 40;
    }
    const links = graphLinks(nodes);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const labels = svg.select("g.labels").selectAll("text").data(Object.entries(centers), (d) => d[0]);
    labels.join("text").attr("class", "group-label").attr("text-anchor", "middle")
      .attr("x", (d) => d[1].x).attr("y", (d) => d[1].top + 18)
      .text((d) => `${t(`groups.${d[0]}`)} · ${nodes.filter((n) => n.group === d[0]).length}`);

    const link = svg.select("g.links").selectAll("line").data(links, (d) => `${d.source}>${d.target}`).join("line").attr("class", "link");
    const node = svg.select("g.nodes").selectAll("g.bubble").data(nodes, (d) => d.id).join(
      (enter) => {
        const g = enter.append("g").attr("class", (d) => `bubble ${d.dir}`).attr("data-cell", "").attr("role", "img");
        g.append("circle").attr("r", 0);
        g.append("text").attr("text-anchor", "middle").attr("dy", "0.35em");
        return g;
      });
    node.attr("class", (d) => `bubble ${d.dir}`)
      .attr("aria-label", tip).attr("data-tip", tip)
      .on("click", (_, d) => select(d.login))
      .on("keydown", (ev, d) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(d.login); } });
    if (reduce) node.select("circle").interrupt().attr("r", (d) => d.r);
    else node.select("circle").transition().duration(250).attr("r", (d) => d.r);
    node.select("text").text((d) => d.r >= 15 ? initials(d.name || d.login) : "");  // 13px initials need the room

    if (sim) sim.stop();
    sim = d3.forceSimulation(nodes)
      .force("x", d3.forceX((d) => centers[d.group].x).strength(0.12))
      .force("y", d3.forceY((d) => centers[d.group].y).strength(0.12))
      .force("collide", d3.forceCollide((d) => d.r + 2))
      .force("link", d3.forceLink(links).id((d) => d.id).distance(24).strength(0.6));
    const place = () => {
      for (const n of nodes) {
        const cell = centers[n.group];
        n.x = Math.max(cell.left + n.r, Math.min(cell.right - n.r, n.x));
        n.y = Math.max(cell.top + LABEL_BAND + n.r, Math.min(cell.bottom - n.r - 6, n.y));
        positions.set(n.id, {x: n.x, y: n.y}); positions.set(n.login, {x: n.x, y: n.y});
      }
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
      link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
    };
    if (reduce) { sim.stop(); for (let i = 0; i < 300; i++) sim.tick(); place(); }
    else sim.alpha(0.8).on("tick", place);

    // one Tab stop for the graph, arrow keys between bubbles (report.js handles [data-roving])
    const svgEl = document.getElementById("graph");
    svgEl.dataset.roving = ""; svgEl.setAttribute("role", "group");
    svgEl.setAttribute("aria-label", t("a11y.grid", {label: t("connections.title")}));
    svgEl.querySelectorAll("[data-cell]").forEach((c, i) => { c.tabIndex = i ? -1 : 0; });
  }

  function tip(d) {
    return `${d.login}${d.name ? ` · ${d.name}` : ""} · ${t("connections.tip_counts", {received: d.received, given: d.given})} · ` +
      `${t(`groups.${d.group}`)}${d.last ? ` · ${t("connections.tip_last", {when: d.last})}` : ""}`;
  }

  function select(login) {
    const search = document.getElementById("logSearch");
    if (!search) return;
    search.value = login;
    search.dispatchEvent(new Event("input", {bubbles: true}));
    document.getElementById("log").scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
  }

  function renderTable(people) {
    const tools = window.reportTools;
    const table = document.getElementById("tblConnections");
    if (!tools || !table) return;
    const order = (g) => GROUPS.indexOf(g);
    tools.makeTable(table, [
      {k: "login", t: t("col.login"), nw: true},
      {k: "name", t: t("col.name"), cls: "name", hide: true, f: (p) => `<span>${tools.esc(p.name ?? "")}</span>`},
      {k: "group", t: t("col.group"), nw: true, sv: (p) => order(p.group), f: (p) => tools.esc(t(`groups.${p.group}`))},
      {k: "received", t: t("col.received"), num: true}, {k: "given", t: t("col.given"), num: true},
      {k: "last", t: t("col.last"), nw: true, hide: true},
    ], people, {sort: ["received", -1]});
  }

  document.addEventListener("report:rendered", (ev) => {
    state = {...state, period: ev.detail.period, all: ev.detail.all};
    const modes = document.getElementById("graphMode");
    if (modes && !modes.dataset.wired) {
      modes.dataset.wired = "1";
      modes.onclick = (e) => {
        const b = e.target.closest("button"); if (!b) return;
        state.mode = b.dataset.v;
        modes.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        draw();
      };
      let width = 0;
      new ResizeObserver((entries) => { const w = Math.round(entries[0].contentRect.width); if (w !== width) { width = w; draw(); } })
        .observe(document.getElementById("graphBox"));
    }
    draw();
  });
}
