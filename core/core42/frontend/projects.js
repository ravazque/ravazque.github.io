"use strict";
// Projects table logic shared by the web app and the GitHub Pages site: filters, rank groups, CSV.

// The projects table: track (student = Common Core + Outer Core, piscine, all), name search, mark filter, year
const PROJECT_GROUPS = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06", "outer-core", "piscine"];
function projectView(projects, {track = "student", search = "", marks = "all", year = "all"} = {}) {
  const q = search.trim().toLowerCase();
  const markOk = {
    all: () => true, bonus: (p) => p.mark > 100, max: (p) => p.mark === 125,
    failed: (p) => !p.validated && p.mark != null && p.status === "finished",
  }[marks] || (() => true);
  return projects.filter((p) => (track === "all" || (track === "piscine" ? p.track === "piscine" : p.track !== "piscine")) &&
    (!q || p.name.toLowerCase().includes(q)) && markOk(p) &&
    (year === "all" || (p.marked || p.registered || "").startsWith(year)));
}
function groupProjects(projects) {
  return PROJECT_GROUPS.map((group) => ({group, rows: projects.filter((p) => (p.group || p.track) === group)})).filter((g) => g.rows.length);
}
function toCSV(rows, cols) {
  const cell = (v) => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return [cols.map((c) => cell(c.t)).join(","), ...rows.map((r) => cols.map((c) => cell(c.csv ? c.csv(r) : r[c.k])).join(","))].join("\n") + "\n";
}

if (typeof module !== "undefined" && module.exports) module.exports = {PROJECT_GROUPS, projectView, groupProjects, toCSV};
