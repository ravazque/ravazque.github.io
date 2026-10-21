"use strict";
// CV page: cv.json (hand-written) plus data/42.json (published from the web app).
// Shares radar.js, projects.js, controls.js and the ui.json tokens with the web app.

const STRINGS = {
  en: {
    about: "About", now: "Right now", in_progress: "In progress at 42", experience: "Experience", highlights: "Selected projects",
    cursus: "42 Madrid", level: "Level", to_next: "{pct}% of the way to level {next}", stage: "Stage",
    "stage.rank": "Common Core · Rank {n}", "stage.outer-core": "Outer Core", "stage.alumni": "Alumni",
    common_core: "Common Core validated {when}", coalition: "Coalition", kickoff: "42cursus since",
    evaluations: "Evaluations", evals_note: "Since the 42cursus kickoff.", given: "Given", received: "Received", count: "Total",
    outstanding: "Outstanding", avg: "Average mark", skills: "Skills", student: "Student", piscine: "Piscine", all: "All",
    radar: "Radar", bars: "Bars", projects: "42 projects", project: "Project", group: "Group", mark: "Mark", xp: "XP", date: "Validated",
    search: "Search", search_ph: "Project name", marks: "Mark", marks_all: "Any mark", marks_bonus: "With bonus (over 100)",
    marks_max: "125 only", year: "Year", year_all: "Every year", group_by: "Group by rank", none: "No project matches these filters.",
    shown: "{n} shown", education: "Education", languages: "Languages", stack: "Stack",
    "groups.rank-00": "Rank 00", "groups.rank-01": "Rank 01", "groups.rank-02": "Rank 02", "groups.rank-03": "Rank 03",
    "groups.rank-04": "Rank 04", "groups.rank-05": "Rank 05", "groups.rank-06": "Rank 06", "groups.outer-core": "Outer Core",
    "groups.piscine": "C Piscine", "track.common-core": "Common Core", "track.outer-core": "Outer Core", "track.piscine": "C Piscine",
    since: "since {when}", updated: "42 data as of {when}, published from ravazque.top.", unavailable: "The 42 snapshot could not be loaded right now.",
    language: "Language", theme: "Theme", light: "Light", dark: "Dark", skills_label: "Skills of the {cursus}",
  },
  es: {
    about: "Sobre mí", now: "Ahora mismo", in_progress: "En curso en 42", experience: "Experiencia", highlights: "Proyectos destacados",
    cursus: "42 Madrid", level: "Nivel", to_next: "{pct}% hacia el nivel {next}", stage: "Etapa",
    "stage.rank": "Common Core · Rango {n}", "stage.outer-core": "Outer Core", "stage.alumni": "Alumni",
    common_core: "Common Core validado el {when}", coalition: "Coalición", kickoff: "En el 42cursus desde",
    evaluations: "Evaluaciones", evals_note: "Desde el kickoff del 42cursus.", given: "Dadas", received: "Recibidas", count: "Total",
    outstanding: "Outstanding", avg: "Nota media", skills: "Skills", student: "Estudiante", piscine: "Piscina", all: "Todos",
    radar: "Radar", bars: "Barras", projects: "Proyectos de 42", project: "Proyecto", group: "Grupo", mark: "Nota", xp: "XP", date: "Validado",
    search: "Buscar", search_ph: "Nombre del proyecto", marks: "Nota", marks_all: "Cualquier nota", marks_bonus: "Con bonus (más de 100)",
    marks_max: "Solo 125", year: "Año", year_all: "Todos los años", group_by: "Agrupar por rank", none: "Ningún proyecto cumple estos filtros.",
    shown: "{n} mostrados", education: "Formación", languages: "Idiomas", stack: "Stack",
    "groups.rank-00": "Rank 00", "groups.rank-01": "Rank 01", "groups.rank-02": "Rank 02", "groups.rank-03": "Rank 03",
    "groups.rank-04": "Rank 04", "groups.rank-05": "Rank 05", "groups.rank-06": "Rank 06", "groups.outer-core": "Outer Core",
    "groups.piscine": "Piscina C", "track.common-core": "Common Core", "track.outer-core": "Outer Core", "track.piscine": "Piscina C",
    since: "desde {when}", updated: "Datos de 42 a {when}, publicados desde ravazque.top.", unavailable: "Ahora mismo no se pudo cargar la foto de 42.",
    language: "Idioma", theme: "Tema", light: "Claro", dark: "Oscuro", skills_label: "Skills del {cursus}",
  },
};
const LOCALES = {en: "en-GB", es: "es-ES"};

function pickLang(languages) {
  return /^es\b/i.test((languages || [])[0] || "") ? "es" : "en";
}

function makeT(lang) {
  const dict = STRINGS[lang] || STRINGS.en;
  return (key, vars = {}) => String(dict[key] ?? STRINGS.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

const pick = (v, lang) => v == null ? "" : typeof v === "object" ? v[lang] ?? v.en ?? "" : String(v);

const round2 = (x) => Math.round(x * 100) / 100;

function levelParts(level) {
  const whole = Math.floor(level);
  return {whole, frac: round2(level - whole)};
}

// One seat per level: full seats up to the level, the next one lit by the fraction
function seatFill(level, cells) {
  return Array.from({length: cells}, (_, i) => Math.max(0, Math.min(1, round2(level - i))));
}

function stageLabel(stage, t) {
  if (!stage) return "";
  const rank = /^rank-(\d\d)$/.exec(stage);
  return rank ? t("stage.rank", {n: rank[1]}) : t(`stage.${stage}`);
}

// "2025-03-02" → 2 Mar 2025; "2024-07" → July 2024
function fmtDate(iso, lang) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso || "");
  if (!m) return "";
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1)));
  const opts = m[3] ? {day: "numeric", month: "short", year: "numeric"} : {month: "long", year: "numeric"};
  return date.toLocaleDateString(LOCALES[lang] || "en-GB", {...opts, timeZone: "UTC"}).replace(/\.$/, "").replace(/\bSept\b/, "Sep");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}

// published projects in the shape projects.js filters (every published project is validated)
function snapshotProjects(snap) {
  return ((snap && snap.projects && snap.projects.list) || []).map((p) => ({name: p.name, track: p.track, group: p.group, mark: p.mark,
    xp_earned: p.xp, validated: true, status: "finished", marked: p.validated, date: p.validated}));
}

if (typeof module !== "undefined" && module.exports) module.exports = {pickLang, makeT, pick, levelParts, seatFill, stageLabel, fmtDate, esc, snapshotProjects};

const ICONS = {
  github: '<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>',
  linkedin: '<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>',
  intra: '<rect x="1" y="1" width="22" height="22" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><rect x="6" y="6" width="5" height="5" rx="1"/><rect x="13" y="6" width="5" height="5" rx="1" opacity=".45"/><rect x="6" y="13" width="5" height="5" rx="1" opacity=".45"/><rect x="13" y="13" width="5" height="5" rx="1"/>',
};

if (typeof window !== "undefined" && document.getElementById("cursus")) {
  (async () => {
    const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
    const store = {
      get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
      set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: the choice lasts this visit */ } },
    };
    const getJSON = async (url) => {
      try { const r = await fetch(url, {cache: "no-cache"}); return r.ok ? await r.json() : null; } catch { return null; }
    };
    let lang = store.get("lang") || pickLang(navigator.languages || [navigator.language]);
    const [snap, cv] = await Promise.all([getJSON("data/42.json"), getJSON("cv.json")]);
    if (window.applyAccent) applyAccent("#00babc");  // 42 blue, the web app's default accent
    const projects = snapshotProjects(snap);
    const view = {track: "student", search: "", marks: "all", year: "all", grouped: false, sort: "date", dir: -1};
    let skillSet = "student", skillView = "radar";
    $$("select").forEach((s) => window.enhanceSelect && enhanceSelect(s));

    const seats = (fills, cls = "") => `<span class="seats ${cls}" aria-hidden="true">${fills.map((f, i) =>
      `<span class="seat"${f ? ` style="--f:${f};--n:${i}"` : ""}>${f ? "<i></i>" : ""}</span>`).join("")}</span>`;
    const tags = (items) => `<ul class="tags">${(items || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;

    function renderCV(t) {
      $("#headline").textContent = pick(cv?.headline, lang);
      $("#links").innerHTML = (cv?.links || []).map((l) => `<a href="${esc(l.url)}" rel="me noopener" target="_blank">` +
        `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[l.icon] || ""}</svg><span>${esc(l.label)}</span></a>`).join("");
      $("#lead").textContent = pick(cv?.about, lang);
      $("#about").hidden = !cv;
      const inProgress = snap?.projects?.in_progress || [];
      $("#nowText").textContent = pick(cv?.now, lang);
      $("#nowList").innerHTML = inProgress.length ? `<h3>${esc(t("in_progress"))}</h3><ul class="tags">${inProgress.map((p) =>
        `<li title="${esc(t("since", {when: fmtDate(p.since, lang)}))}">${esc(p.name)}</li>`).join("")}</ul>` : "";
      $("#now").hidden = !cv?.now && !inProgress.length;
      $("#experienceList").innerHTML = (cv?.experience || []).map((x) => `<article class="island entry">
        <header><h3>${esc(pick(x.role, lang))}</h3><p class="meta">${esc(pick(x.kind, lang))} · ${esc(x.year)}</p></header>
        <p>${esc(pick(x.text, lang))}</p>${tags(x.stack)}</article>`).join("");
      $("#experience").hidden = !(cv?.experience || []).length;
      $("#highlightList").innerHTML = (cv?.projects || []).map((x) => `<article class="island entry">
        <header><h3>${esc(x.name)}</h3><p class="meta">42 Madrid · ${esc(x.year)}</p></header>
        <p>${esc(pick(x.text, lang))}</p>${tags(x.keywords)}</article>`).join("");
      $("#highlights").hidden = !(cv?.projects || []).length;
      $("#educationList").innerHTML = (cv?.education || []).map((x) => `<article class="island entry">
        <header><h3>${esc(pick(x.title, lang))}</h3><p class="meta">${esc(x.where)} · ${esc(x.years)}</p></header>
        ${x.text ? `<p>${esc(pick(x.text, lang))}</p>` : ""}</article>`).join("");
      $("#languageList").innerHTML = (cv?.languages || []).map((x) => `<li><b>${esc(pick(x.name, lang))}</b> ${esc(pick(x.level, lang))}</li>`).join("");
      $("#stackList").innerHTML = (cv?.stack || []).map((g) => `<div><dt>${esc(pick(g.group, lang))}</dt><dd>${tags(g.items)}</dd></div>`).join("");
    }

    function renderCursus(t) {
      const has = Boolean(snap);
      for (const id of ["#evaluations", "#skills", "#projects"]) $(id).hidden = !has;
      $("#unavailable").hidden = has;
      $("#facts").hidden = !has;
      if (!has) { $("#updated").textContent = ""; return; }
      const c = snap.cursus || {};
      const level = levelParts(c.level || 0);
      const rows = [
        c.level != null && [t("level"), `<span class="level"><b>${level.whole}<small>.${String(Math.round(level.frac * 100)).padStart(2, "0")}</small></b>` +
          `${seats(seatFill(level.frac * 10, 10), "progress")}<span class="sub">${esc(t("to_next", {pct: Math.round(level.frac * 100), next: level.whole + 1}))}</span></span>`],
        c.stage && [t("stage"), `${esc(stageLabel(c.stage, t))}${c.common_core ? `<span class="sub">${esc(t("common_core", {when: fmtDate(c.common_core, lang)}))}</span>` : ""}`],
        snap.coalition && [t("coalition"), `<span class="swatch" style="background:${/^#[0-9a-f]{3,8}$/i.test(snap.coalition.color || "") ? snap.coalition.color : "var(--neutral)"}" aria-hidden="true"></span>${esc(snap.coalition.name)}`],
        c.kickoff && [t("kickoff"), esc(fmtDate(c.kickoff, lang))],
      ].filter(Boolean);
      $("#facts").innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("");
      const e = snap.evaluations || {};
      $("#evalBody").innerHTML = [["given", e.given, e.given_outstanding, null], ["received", e.received, e.received_outstanding, e.received_avg_mark]]
        .map(([k, n, out, avg]) => `<tr><th scope="row">${esc(t(k))}</th><td class="num">${n ?? "–"}</td><td class="num">${out ?? "–"}</td>` +
          `<td class="num">${avg != null ? avg.toFixed(1) : "–"}</td></tr>`).join("");
      $("#updated").textContent = t("updated", {when: fmtDate((snap.updated || "").slice(0, 10), lang)});
    }

    function renderSkills(t) {
      const items = (snap?.skills || {})[skillSet] || [];
      $$("#skillSet button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === skillSet)));
      $$("#skillView button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === skillView)));
      const radar = skillView === "radar", compact = $("#skillRadar").parentElement.clientWidth < 520;
      $("#skillRadar").hidden = !radar; $("#skillBars").hidden = radar;
      $("#skillRadar").classList.toggle("compact", compact);
      $("#skillKey").hidden = !(radar && compact);
      const label = t("skills_label", {cursus: skillSet === "student" ? "42cursus" : "C Piscine"});
      if (radar && window.drawRadar) drawRadar($("#skillRadar"), items, {label, compact});
      if (radar && compact && window.radarKey) radarKey($("#skillKey"), items);
      const top = Math.max(20, ...items.map((s) => Math.ceil(s.level)));
      $("#skillBars").innerHTML = items.filter((s) => s.level > 0).sort((a, b) => b.level - a.level).map((s) =>
        `<li><span class="skill">${esc(s.name)}</span>${seats(seatFill(s.level, top))}<span class="num">${s.level.toFixed(2)}</span></li>`).join("");
    }

    function renderProjects(t) {
      const years = [...new Set(projects.map((p) => (p.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
      const sel = $("#projYear");
      if (sel.options.length !== years.length + 1) {
        sel.innerHTML = `<option value="all">${esc(t("year_all"))}</option>` + years.map((y) => `<option>${y}</option>`).join("");
        sel.value = years.includes(view.year) ? view.year : "all";
        if (sel._refresh) sel._refresh();
      }
      let rows = projectView(projects, view);
      const key = {name: (p) => p.name.toLowerCase(), mark: (p) => p.mark ?? -1, xp: (p) => p.xp_earned, date: (p) => p.date}[view.sort];
      rows = [...rows].sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * view.dir);
      $("#projCount").textContent = t("shown", {n: rows.length});
      $$("#projHead th[data-k]").forEach((th) => {
        if (th.dataset.k === view.sort) th.setAttribute("aria-sort", view.dir > 0 ? "ascending" : "descending"); else th.removeAttribute("aria-sort");
      });
      const row = (p) => `<tr><td>${esc(p.name)}<span class="sub narrow">${esc(t(`groups.${p.group}`))}</span></td>` +
        `<td class="wide">${esc(t(`groups.${p.group}`))}</td><td class="num${p.mark > 100 ? " bonus" : ""}">${p.mark ?? "–"}</td>` +
        `<td class="num wide">${(p.xp_earned || 0).toLocaleString(LOCALES[lang])}</td><td class="num date">${esc(fmtDate(p.date, lang))}</td></tr>`;
      const body = !rows.length ? `<tbody><tr><td class="empty" colspan="5">${esc(t("none"))}</td></tr></tbody>`
        : view.grouped ? groupProjects(rows).map((g) => `<tbody class="group"><tr><th scope="rowgroup" colspan="5">${esc(t(`groups.${g.group}`))} ` +
          `<span class="count">${g.rows.length}</span></th></tr></tbody><tbody>${g.rows.map(row).join("")}</tbody>`).join("")
        : `<tbody>${rows.map(row).join("")}</tbody>`;
      $("#projTable").querySelectorAll("tbody").forEach((b) => b.remove());
      $("#projTable").insertAdjacentHTML("beforeend", body);
    }

    function render() {
      const t = makeT(lang);
      document.documentElement.lang = lang;
      $$("[data-t]").forEach((el) => { el.textContent = t(el.dataset.t); });
      $$("[data-t-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.tPlaceholder); });
      if (snap?.name) $("#name").textContent = snap.name;
      $("#title").textContent = snap?.title ? ` · ${snap.title}` : "";
      renderCV(t); renderCursus(t);
      if (snap) { renderSkills(t); renderProjects(t); }
      $$("select").forEach((s) => s._refresh && s._refresh());
      syncToggles();
    }

    const effectiveTheme = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    function syncToggles() {
      $$("#langToggle button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === lang)));
      $$("#themeToggle button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === effectiveTheme())));
    }
    const onSeg = (id, fn) => { $(id).onclick = (ev) => { const b = ev.target.closest("button"); if (b) fn(b.dataset.v); }; };
    onSeg("#langToggle", (v) => { lang = v; store.set("lang", v); render(); });
    onSeg("#themeToggle", (v) => { document.documentElement.dataset.theme = v; store.set("theme", v); syncToggles(); });
    onSeg("#skillSet", (v) => { skillSet = v; renderSkills(makeT(lang)); });
    onSeg("#skillView", (v) => { skillView = v; renderSkills(makeT(lang)); });
    onSeg("#projTrack", (v) => {
      view.track = v; $$("#projTrack button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v))); renderProjects(makeT(lang));
    });
    $("#projSearch").oninput = (ev) => { view.search = ev.target.value; renderProjects(makeT(lang)); };
    $("#projMarks").onchange = (ev) => { view.marks = ev.target.value; renderProjects(makeT(lang)); };
    $("#projYear").onchange = (ev) => { view.year = ev.target.value; renderProjects(makeT(lang)); };
    $("#projGroup").onclick = (ev) => {
      view.grouped = !view.grouped; ev.currentTarget.setAttribute("aria-pressed", String(view.grouped)); renderProjects(makeT(lang));
    };
    $("#projHead").onclick = (ev) => {
      const th = ev.target.closest("th[data-k]"); if (!th) return;
      view.dir = view.sort === th.dataset.k ? -view.dir : th.dataset.k === "name" ? 1 : -1;
      view.sort = th.dataset.k; renderProjects(makeT(lang));
    };
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncToggles);
    let width = 0;
    addEventListener("resize", () => {
      const w = $("#skillRadar").parentElement.clientWidth;
      if (Math.abs(w - width) > 40) { width = w; if (snap) renderSkills(makeT(lang)); }
    }, {passive: true});
    render();
    document.body.classList.add("ready");
  })();
}
