"use strict";
// Report page renderer: startReport(data, {i18n}). Served as /shared/report.js or inlined into single-file pages.

// ---------- i18n (pure, also loaded by node --test) ----------
let DICT = {};
const warned = new Set();
function setDict(d) { DICT = d || {}; }
function t(key, vars = {}) {
  let v = DICT[key];
  if (v == null) {
    if (!warned.has(key)) { warned.add(key); if (typeof console !== "undefined") console.warn(`i18n: missing "${key}"`); }
    return key;
  }
  if (typeof v === "object") v = vars.count === 1 && v.one != null ? v.one : v.other;
  return String(v).replace(/\{(\w+)\}/g, (m, k) => vars[k] != null ? vars[k] : m);
}
// "student" is the 42cursus: Common Core and Outer Core together
function filterTrack(projects, track) {
  return projects.filter((p) => track === "student" ? p.track === "common-core" || p.track === "outer-core" : p.track === track);
}
// The rank the student is working on, as the Connections graph groups people; null outside the 42cursus
function myRank(extras) {
  const main = ((extras && extras.cursus) || []).find((c) => c.name === "42cursus");
  if (!main) return null;
  if (main.grade === "Alumni") return "alumni";
  const done = (extras.quests || []).filter((q) => q.validated);
  if (main.grade === "Transcender" || done.some((q) => q.name === "Common Core")) return "outer-core";
  const ranks = done.map((q) => /^Common Core Rank (\d\d)$/.exec(q.name)).filter(Boolean).map((m) => +m[1]);
  return `rank-${String(ranks.length ? Math.max(...ranks) + 1 : 0).padStart(2, "0")}`;
}
// colours from the API go into style attributes: only plain hex passes
const safeColor = (c) => /^#[0-9a-f]{3,8}$/i.test(c || "") ? c : "var(--neutral)";

// The cursus stage for the identity: the Common Core rank being worked on, Outer Core or Alumni (never the coalition rank)
function stageLabel(extras, tr = t) {
  if (!extras) return "";
  const rank = myRank(extras);
  return rank ? tr(`groups.${rank}`) : tr("home.no_cursus");
}

// a scroll box (long list or table) still has rows below its bottom edge
function moreBelow(box) {
  return box.scrollHeight - box.scrollTop - box.clientHeight > 2;
}
if (typeof module !== "undefined" && module.exports) module.exports = {setDict, t, filterTrack, myRank, moreBelow, stageLabel, safeColor};

function startReport(DATA, {i18n} = {}) {
  setDict(i18n);
  const PAGE = DATA.page;
  const LIGHT = DATA.light === true;
  const PERIOD_KEYS = Object.keys(DATA.periods);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => s == null ? "" : String(s).replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const locale = () => t("_locale");
  // a photo that fails to load leaves the initials underneath (error events do not bubble: capture)
  document.addEventListener("error", (e) => { if (e.target.matches?.(".avatar img, .avatar-lg img")) e.target.remove(); }, true);
  const num = (v, d = 0) => v == null ? "–" : Number(v).toLocaleString(locale(), {maximumFractionDigits: d});
  const pct = (a, b) => b ? Math.round(100 * a / b) + "%" : "–";
  const TZ = "Europe/Madrid";
  const months = () => t("_months").split(" ");
  const weekdays = () => t("_weekdays").split(" ");
  const monthLabel = (ym) => `${months()[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`;
  const fmtMonth = (ms) => { const [m, y] = new Date(ms).toLocaleDateString("en-GB", {timeZone: TZ, month: "2-digit", year: "numeric"}).split("/"); return monthLabel(`${y}-${m}`); };
  const fmtDate = (ms) => new Date(ms).toLocaleString(locale(), {timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"});
  // en-GB abbreviates September as "Sept"; every other month gets three letters
  const fmtDay = (iso, o = {day: "numeric", month: "short", year: "numeric"}) => iso ? new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString(locale(), {timeZone: "UTC", ...o}).replace(/\bSept\b/, "Sep") : "–";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const split = (sec) => [Math.floor(sec / 3600), String(Math.floor(sec % 3600 / 60)).padStart(2, "0")];
  const hm = (sec) => { const [h, m] = split(sec); return t("unit.hm", {h, m}); };
  const hmHtml = (sec) => { const [h, m] = split(sec); return `${h}<small>h</small> ${m}<small>m</small>`; };
  const range = (n) => Array.from({length: n}, (_, i) => i);
  const plural = (n, key) => t(key, {count: n, n: num(n)});
  const nb = (v, unit, d = 1) => `${num(v, d)} ${unit}`;
  const initialsOf = (s) => String(s || "?").split(/[\s._-]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  // Each page keeps only its own sections
  $$("[data-pages]").forEach((s) => s.dataset.pages.split(" ").includes(PAGE) || s.remove());
  document.body.dataset.page = PAGE;
  document.body.classList.toggle("light-data", LIGHT);
  const has = (id) => document.getElementById(id) != null;

  let period = PERIOD_KEYS.includes(store.get("period:" + PAGE)) ? store.get("period:" + PAGE) : DATA.default_period;
  let D = DATA.periods[period];
  const P = D.profile;
  const periodLabel = (p) => t(`period.${p}`);
  const periodRange = (p) => { const L = DATA.periods[p].logtime; return L.first_day ? `${fmtDay(L.first_day)} → ${fmtDay(L.last_day)}` : t("rail.no_sessions"); };

  function applyI18n() {
    document.documentElement.lang = t("_lang");
    $$("[data-i18n]").forEach((el) => { if (DICT[el.dataset.i18n] != null) el.textContent = t(el.dataset.i18n); });
    $$("[data-i18n-attr]").forEach((el) => el.dataset.i18nAttr.split(";").forEach((pair) => {
      const [attr, key] = pair.split(":");
      if (DICT[key] != null) el.setAttribute(attr, t(key));
    }));
  }

  // ---------- rail ----------
  // the campus the student belongs to now (older reports list every campus: keep the last one)
  const campusNow = () => P.campus_current || (Array.isArray(P.campus) ? P.campus[P.campus.length - 1] : P.campus) || "";
  function renderIdentity() {
    $("#identity").innerHTML = `
      <div class="avatar-lg"><span aria-hidden="true">${esc(initialsOf(P.name))}</span>${P.image ? `<img src="${esc(P.image)}" alt="">` : ""}</div>
      <div><h1>${esc(P.name)}</h1><p>${esc(P.login)}${campusNow() ? ` · ${esc(campusNow())}` : ""}</p>
      <p class="coal">${P.coalition ? `<i style="background:${safeColor(P.coalition.color)}"></i>${esc(P.coalition.name)}` : ""}${P.coalition && stageLabel(D.extras) ? " · " : ""}${esc(stageLabel(D.extras))}</p></div>`;
    $("#toc").innerHTML = $$("section[data-title-i18n]").map((s) => `<a href="#${s.id}">${esc(t(s.dataset.titleI18n))}</a>`).join("");
    if (DATA.pages) {
      $("#pages").hidden = false;
      $("#brand").setAttribute("href", DATA.pages[0].href);
      $("#pages").innerHTML = DATA.pages.map((pg) => `<a href="${esc(pg.href)}"${pg.page === PAGE ? ' aria-current="page"' : ""}>${esc(t(`pages.${pg.key}`))}</a>`).join("");
    }
    if (PERIOD_KEYS.length > 1) {
      $("#periods").innerHTML = PERIOD_KEYS.map((p) =>
        `<button type="button" data-p="${p}"><b>${esc(periodLabel(p))}</b><span>${hm(DATA.periods[p].logtime.total_seconds)}</span></button>`).join("");
      $("#periods").onclick = (ev) => { const b = ev.target.closest("button"); if (b) setPeriod(b.dataset.p); };
    } else {
      $("#periods").removeAttribute("role");
      $("#periods").innerHTML = `<p class="only"><b>${esc(t("rail.cursus_only"))}</b>${esc(t("rail.cursus_only_note"))}</p>`;
    }
    watchToc();
  }

  function renderRail() {
    const L = D.logtime;
    $$("#periods button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.p === period));
    const [h, m] = split(L.total_seconds);
    $("#figure").innerHTML = `
      <p class="label">${esc(t("rail.logged_in", {range: periodRange(period)}))}</p>
      <div class="big" aria-label="${esc(t("rail.figure_aria", {h, m}))}"><span>${h}<small>h</small></span> <span>${m}<small>m</small></span></div>
      <div class="stats">
        <div><b>${num(L.days_present)}</b><span>${esc(t("rail.days", {count: L.days_present}))}</span></div>
        <div><b>${num(L.sessions)}</b><span>${esc(t("rail.sessions", {count: L.sessions}))}</span></div>
        <div><b>${num(L.seats.length)}</b><span>${esc(t("rail.computers", {count: L.seats.length}))}</span></div>
      </div>
      <p class="now">${P.location ? t("rail.now_at", {seat: `<b>${esc(P.location)}</b>`}) : esc(t("rail.not_logged"))}</p>`;
  }

  // toc: highlight the section in view
  let tocIO;
  function watchToc() {
    if (tocIO) tocIO.disconnect();
    const links = Object.fromEntries($$("#toc a").map((a) => [a.hash.slice(1), a]));
    tocIO = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      Object.values(links).forEach((a) => a.removeAttribute("aria-current"));
      links[e.target.id]?.setAttribute("aria-current", "true");
    }), {rootMargin: "-30% 0px -65% 0px"});
    $$("section[data-title-i18n]").forEach((s) => tocIO.observe(s));
  }

  // theme: auto (system) / light / dark, remembered
  function applyTheme(v) {
    if (v === "light" || v === "dark") document.documentElement.dataset.theme = v;
    else delete document.documentElement.dataset.theme;
    $$("#theme button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === (v || "auto")));
  }
  applyTheme(store.get("theme"));
  $("#theme").onclick = (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    store.set("theme", b.dataset.v); applyTheme(b.dataset.v); resetCharts();
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => resetCharts());

  // ---------- settings: the gear opens a small panel (accent, theme; the web adds language and account) ----------
  const gear = $("#gearBtn"), settings = $("#settings");
  const openSettings = (open) => { settings.hidden = !open; gear.setAttribute("aria-expanded", String(open)); };
  gear.onclick = () => openSettings(settings.hidden);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !settings.hidden) { openSettings(false); gear.focus(); } });
  document.addEventListener("click", (ev) => { if (!settings.hidden && !ev.target.closest(".settings-wrap")) openSettings(false); });

  // accent: the intra blue by default, or the coalition colour; remembered per browser
  const INTRA_BLUE = "#00babc";
  function applyAccentChoice(v) {
    const coal = P.coalition && P.coalition.color;
    const choice = v === "coalition" && coal ? "coalition" : "intra", color = choice === "coalition" ? coal : INTRA_BLUE;
    if (window.applyAccent) window.applyAccent(color);
    $$("#accentChoice button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === choice)));
    $("#accentChoice [data-v=coalition]").disabled = !coal;
    document.dispatchEvent(new CustomEvent("accent:change", {detail: color}));
  }
  applyAccentChoice(store.get("accent"));
  $("#accentChoice").onclick = (ev) => {
    const b = ev.target.closest("button"); if (!b || b.disabled) return;
    store.set("accent", b.dataset.v); applyAccentChoice(b.dataset.v); resetCharts(); if (has("extras")) renderSkills();
  };

  // ---------- tooltips (mouse and keyboard) ----------
  const tip = $("#tip");
  function showTip(text, x, y) {
    tip.textContent = text; tip.style.display = "block";
    tip.style.left = Math.max(8, Math.min(x, innerWidth - tip.offsetWidth - 8)) + "px";
    tip.style.top = (y + tip.offsetHeight + 8 > innerHeight ? y - tip.offsetHeight - 28 : y) + "px";
  }
  document.addEventListener("mousemove", (ev) => {
    const el = ev.target.closest("[data-tip]");
    if (el) showTip(el.dataset.tip, ev.clientX + 12, ev.clientY + 16);
    else if (!document.activeElement?.dataset?.tip) tip.style.display = "none";
  });
  document.addEventListener("focusin", (ev) => {
    const el = ev.target.closest("[data-tip]");
    if (!el) { tip.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    showTip(el.dataset.tip, r.left, r.bottom + 8);
  });
  document.addEventListener("focusout", () => { tip.style.display = "none"; });

  // ---------- building blocks ----------
  // initials always render; a photo, when there is one, covers them and disappears if it cannot load
  function avatar(person) {
    const p = person || {};
    return `<span class="avatar" data-i="${esc(initialsOf(p.name || p.login))}" aria-hidden="true">${p.image ? `<img loading="lazy" src="${esc(p.image)}" alt="">` : ""}</span>`;
  }
  function flagBadge(e) {
    if (e.outstanding) return `<span class="badge out">${esc(t("flag.outstanding"))}</span>`;
    if (e.negative_flag) return `<span class="badge bad">${esc(e.flag)}</span>`;
    return e.flag ? `<span class="badge">${esc(e.flag)}</span>` : "";
  }
  const ramp = (v, max) => Math.sqrt(v / max).toFixed(3);
  const AMBER = ["var(--ramp-hi)", "var(--ramp-lo)"], SLATE = ["var(--slate)", "var(--slate-lo)"];
  const mix = ([hi, lo], v) => `color-mix(in oklab, ${hi} ${(v * 100).toFixed(1)}%, ${lo})`;
  function scale(el, max, unit, colors = AMBER) {
    el.innerHTML = `<span class="grp"><i style="background:var(--seat-empty)"></i>${esc(t("scale.none"))}</span>` +
      `<span class="grp">${esc(t("scale.less"))}${[0, 0.25, 0.5, 0.75, 1].map((s) => `<i style="background:${mix(colors, s)}"></i>`).join("")}${esc(t("scale.more", {max: num(max, 1), unit}))}</span>`;
  }

  // Grids of cells (seat plans, calendar, heatmaps) take one Tab stop; arrow keys move inside
  function roving(grid, label) {
    grid.dataset.roving = ""; grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", t("a11y.grid", {label}));
    grid.querySelectorAll("[data-cell]").forEach((c, i) => { c.tabIndex = i ? -1 : 0; });
  }
  document.addEventListener("keydown", (ev) => {
    const cell = ev.target.closest && ev.target.closest("[data-cell]");
    const grid = cell && cell.closest("[data-roving]");
    if (!grid) return;
    const cells = [...grid.querySelectorAll("[data-cell]")], i = cells.indexOf(cell);
    let next;
    if (ev.key === "ArrowRight") next = cells[i + 1];
    else if (ev.key === "ArrowLeft") next = cells[i - 1];
    else if (ev.key === "Home") next = cells[0];
    else if (ev.key === "End") next = cells[cells.length - 1];
    else if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
      const r = cell.getBoundingClientRect(), dir = ev.key === "ArrowDown" ? 1 : -1;
      let best = Infinity;
      for (const c of cells) {
        const q = c.getBoundingClientRect(), dy = (q.top - r.top) * dir;
        if (dy < 2) continue;
        const score = dy * 4 + Math.abs(q.left - r.left);
        if (score < best) { best = score; next = c; }
      }
    } else return;
    ev.preventDefault();
    if (next) { cell.tabIndex = -1; next.tabIndex = 0; next.focus(); }
  });

  function makeTable(el, cols, rows, {sort, empty = t("empty.period"), sticky = false, detail, group} = {}) {
    el.classList.toggle("sticky-first", sticky);
    let key = sort ? sort[0] : null, dir = sort ? sort[1] : 1;
    function draw() {
      const col = cols.find((c) => c.k === key);
      let sorted = col ? [...rows].sort((a, b) => {
        const va = col.sv ? col.sv(a) : a[col.k], vb = col.sv ? col.sv(b) : b[col.k];
        if (va == null) return 1; if (vb == null) return -1;
        return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
      }) : rows;
      if (group) sorted = [...sorted].sort((a, b) => group.order.indexOf(group.key(a)) - group.order.indexOf(group.key(b)));
      const head = cols.map((c) => `<th scope="col" class="${c.num ? "num" : ""}${c.hide ? " narrow-hide" : ""}"${c.k === key ? ` aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>` +
        `<button type="button" data-k="${c.k}">${esc(c.t)}</button></th>`).join("");
      const row = (r) => `<tr>${cols.map((c) => `<td class="${c.num ? "num" : ""} ${c.nw ? "nowrap" : ""} ${c.hide ? "narrow-hide" : ""} ${c.cls || ""}">${c.f ? c.f(r) : esc(r[c.k] ?? "")}</td>`).join("")}</tr>`;
      // with a detail, each record is its own tbody: the record line plus a full-width line under it
      const body = !sorted.length ? `<tbody><tr><td class="empty" colspan="${cols.length}">${esc(empty)}</td></tr></tbody>`
        : detail || group ? sorted.map((r, i) => {
          const g = group ? group.key(r) : null;
          const head = group && (i === 0 || group.key(sorted[i - 1]) !== g)
            ? `<tbody class="group"><tr><th scope="rowgroup" colspan="${cols.length}">${esc(group.label(g))} <span class="note">${sorted.filter((x) => group.key(x) === g).length}</span></th></tr></tbody>` : "";
          const d = detail ? detail(r) : "";
          return head + (d ? `<tbody class="pair">${row(r)}<tr class="detail"><td colspan="${cols.length}">${d}</td></tr></tbody>` : `<tbody>${row(r)}</tbody>`);
        }).join("")
        : `<tbody>${sorted.map(row).join("")}</tbody>`;
      el.innerHTML = `<thead><tr>${head}</tr></thead>${body}`;
    }
    el.onclick = (ev) => {
      const b = ev.target.closest("th button"); if (!b) return;
      dir = key === b.dataset.k ? -dir : (cols.find((c) => c.k === b.dataset.k).num ? -1 : 1);
      key = b.dataset.k; draw();
    };
    draw();
    return {set(r) { rows = r; draw(); }};
  }

  // Cluster plan: hours (or counts) per seat, row by row
  // values may be in any unit; toUnit converts sums and the legend once, so totals never add rounded numbers
  function seatPlan(el, scaleEl, values, {unit, detail, toUnit = (v) => v, anchor = false}) {
    const max = Math.max(0, ...Object.values(values));
    const topHost = Object.keys(values).find((h) => values[h] === max);
    const most = ` · ${t("plan.most_used_short")}`;
    const seen = new Set();
    el.innerHTML = Object.entries(DATA.layout).map(([c, {rows, seats}]) => {
      let total = 0, html = "";
      for (let r = 1; r <= rows; r++) {
        html += `<div class="row" style="--seats:${seats}"><span class="rn" aria-hidden="true">r${r}</span>` + range(seats).map((s) => {
          const host = `${c}r${r}s${s + 1}`, v = values[host];
          if (!v) return `<span class="seat"></span>`;
          total += v; seen.add(host);
          const label = detail(host, v) + (host === topHost ? most : "");
          return `<span class="seat on${host === topHost ? " top" : ""}"${anchor ? ` id="seat-${host}"` : ""} data-cell role="img" style="--v:${ramp(v, max)}" aria-label="${esc(label)}" data-tip="${esc(label)}"></span>`;
        }).join("") + "</div>";
      }
      return `<figure class="cluster"><figcaption><b>${c}</b><span>${num(toUnit(total), 1)} ${unit}</span></figcaption>${html}</figure>`;
    }).join("");
    const other = Object.entries(values).filter(([h]) => !seen.has(h));
    if (other.length) el.insertAdjacentHTML("beforeend", `<p class="note plan-other">${esc(t("plan.not_on_plan", {list: other.map(([h, v]) => `${h} (${num(toUnit(v), 1)} ${unit})`).join(", ")}))}</p>`);
    if (max) scale(scaleEl, toUnit(max), unit); else scaleEl.innerHTML = `<span>${esc(t("empty.period"))}</span>`;
    scaleEl.insertAdjacentHTML("beforeend", topHost ? `<span class="grp"><i style="background:var(--seat-empty);box-shadow:inset 0 0 0 2px var(--ink)"></i>${esc(t("plan.most_used", {seat: topHost}))}</span>` : "");
    roving(el, t("plan.label"));
  }

  function heat(el, grid, colors, unit) {
    const max = Math.max(0, ...grid.flat());
    const WD = weekdays();
    let html = `<div class="heat"><span></span>${range(24).map((h) => `<span class="h" aria-hidden="true">${h % 3 ? "" : h}</span>`).join("")}`;
    grid.forEach((row, w) => {
      html += `<span>${WD[w]}</span>` + row.map((v, h) => {
        if (!v) return `<span class="c"></span>`;
        const label = `${WD[w]} ${String(h).padStart(2, "0")}:00 · ${num(v, 1)} ${unit}`;
        return `<span class="c" data-cell role="img" aria-label="${esc(label)}" data-tip="${esc(label)}" style="background:${mix(colors, +ramp(v, max))}"></span>`;
      }).join("");
    });
    html += "</div>";
    el.innerHTML = html + `<div class="scale"></div>`;
    if (max) scale(el.lastElementChild, max, unit, colors); else el.lastElementChild.textContent = t("empty.period");
    roving(el.firstElementChild, t("heat.label"));
  }

  function calendar(el, scaleEl, days, hours) {
    const max = Math.max(0, ...hours);
    const years = {};
    days.forEach((d, i) => (years[d.slice(0, 4)] ||= []).push([d, hours[i]]));
    const crop = Object.keys(years).length === 1;
    el.innerHTML = Object.entries(years).map(([y, list]) => {
      const jan1 = new Date(Date.UTC(+y, 0, 1));
      const offset = (jan1.getUTCDay() + 6) % 7;  // Monday-first column of Jan 1
      const week = (iso) => Math.floor((Math.round((Date.parse(iso + "T00:00:00Z") - jan1) / 864e5) + offset) / 7);
      const skip = crop ? week(list[0][0]) : 0;
      const pos = (iso) => {
        const n = Math.round((Date.parse(iso + "T00:00:00Z") - jan1) / 864e5) + offset;
        return [Math.max(1, Math.floor(n / 7) + 1 - skip), n % 7 + 2];  // [column, row]; row 1 holds month names
      };
      let monthCells = "", cells = "";
      for (let m = 0; m < 12; m++) {
        const iso = `${y}-${String(m + 1).padStart(2, "0")}-01`;
        if (list.some(([d]) => d.slice(0, 7) === iso.slice(0, 7))) {
          monthCells += `<span class="m" style="grid-area:1/${pos(iso)[0]}/2/span 4">${months()[m]}</span>`;
        }
      }
      for (const [d, v] of list) {
        const [c, r] = pos(d);
        const label = `${fmtDay(d, {weekday: "short", day: "numeric", month: "short", year: "numeric"})} · ${v ? num(v, 1) + " h" : t("calendar.not_logged")}`;
        cells += v
          ? `<span class="d on" data-cell role="img" style="grid-area:${r}/${c};--v:${ramp(v, max)}" aria-label="${esc(label)}" data-tip="${esc(label)}"></span>`
          : `<span class="d" style="grid-area:${r}/${c}" data-tip="${esc(label)}"></span>`;
      }
      const cols = week(list[list.length - 1][0]) - skip + 1;
      return `<div class="cal-year"><b>${y}</b><div class="cal-grid${crop ? " crop" : ""}" style="--cols:${Math.max(cols, 5)}">${monthCells}${cells}</div></div>`;
    }).join("") || `<p class="note">${esc(t("empty.sessions"))}</p>`;
    if (max) scale(scaleEl, max, t("unit.h_per_day")); else scaleEl.innerHTML = "";
    roving(el, t("calendar.label"));
  }

  // ---------- charts (Chart.js, drawn when scrolled into view) ----------
  const chartDefs = new Map(), charts = new Map();
  const def = (id, fn) => { if (has(id)) chartDefs.set(id, fn); };
  const chartIO = window.Chart && new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting && !charts.has(e.target.id)) buildChart(e.target.id);
  }), {rootMargin: "400px 0px"});

  function theme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return {s1: v("--amber-data"), s2: v("--slate"), good: v("--good"), critical: v("--critical"), neutral: v("--neutral"),
      surface: v("--surface"), ground: v("--ground"), ink: v("--ink"), text2: v("--text-2"), muted: v("--muted"),
      rule: v("--rule"), strong: v("--rule-strong")};
  }
  function buildChart(id) {
    const canvas = document.getElementById(id);
    const cfg = chartDefs.get(id)(theme());
    canvas.parentElement.dataset.empty = cfg ? "" : t("empty.period");
    if (cfg) charts.set(id, new Chart(canvas, cfg));
  }
  function resetCharts() {
    if (!window.Chart) {
      $$(".plot").forEach((p) => { p.dataset.empty = t("empty.no_chartjs"); });
      return;
    }
    charts.forEach((c) => c.destroy()); charts.clear();
    chartIO.disconnect();
    chartDefs.forEach((_, id) => chartIO.observe(document.getElementById(id)));  // observe() reports what is visible now
  }

  function axes(th, {xTime = false, stacked = false, horizontal = false, yMax, xTitle, range: span} = {}) {
    const tick = {color: th.muted, font: {size: 13}};
    const valueAxis = {beginAtZero: true, stacked, grid: {color: th.rule, drawTicks: false}, border: {display: false, dash: [2, 4]},
      ticks: {...tick, precision: 0, padding: 8}, max: yMax};
    const catAxis = {stacked, grid: {display: false}, border: {color: th.strong, width: 2}, ticks: {...tick, autoSkip: true, maxRotation: 0},
      title: xTitle ? {display: true, text: xTitle, color: th.muted, font: {size: 13}} : undefined};
    if (xTime && !horizontal) Object.assign(catAxis, {type: "linear", ...span, ticks: {...tick, maxRotation: 0, callback: (v) => fmtMonth(v), maxTicksLimit: 10}});
    return horizontal ? {x: valueAxis, y: {...catAxis, ticks: {...catAxis.ticks, autoSkip: false, color: th.text2}}} : {x: catAxis, y: valueAxis};
  }
  function opts(th, axisOpts = {}) {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      indexAxis: axisOpts.horizontal ? "y" : "x",
      interaction: axisOpts.xTime ? {mode: "nearest", axis: "x", intersect: false} : {mode: "index", intersect: false},
      plugins: {
        legend: {display: false},
        tooltip: {backgroundColor: th.ink, titleColor: th.ground, bodyColor: th.ground, footerColor: th.ground, padding: 10, cornerRadius: 4,
          titleFont: {family: "Barlow Semi Condensed", weight: "700", size: 15}, bodyFont: {size: 14},
          callbacks: axisOpts.xTime ? {title: (items) => items.length ? fmtDate(items[0].parsed.x) : ""} : {}},
      },
      scales: axes(th, axisOpts),
    };
  }
  const bar = (label, data, color, extra = {}) => ({label, data, backgroundColor: color, borderRadius: 2, maxBarThickness: 48, ...extra});
  const line = (label, data, color, extra = {}) => ({label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, stepped: true, ...extra});
  // stacked segments get a hairline of page colour between them
  const seg = (th) => ({borderRadius: 0, borderWidth: 1, borderColor: th.ground});
  const flagStack = (m, th, base) => [bar(t("flag.ok"), m.ok, base, seg(th)), bar(t("flag.outstanding"), m.outstanding, th.good, seg(th)),
    bar(t("flag.negative"), m.negative, th.critical, seg(th))];
  // time axes span the data, not the next round month
  function timeRange(...series) {
    const xs = series.flat().map((p) => p.x);
    if (!xs.length) return {};
    const lo = Math.min(...xs), hi = Math.max(...xs), pad = Math.max((hi - lo) * 0.02, 864e5);
    return {min: lo - pad, max: hi + pad};
  }
  // horizontal bars carry their value at the bar end instead of a value axis
  function endLabels(th, fmt) {
    return {id: "endLabels", afterDatasetsDraw(chart) {
      const metas = chart.data.datasets.map((_, i) => chart.getDatasetMeta(i));
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = "600 13px Barlow, system-ui, sans-serif"; ctx.fillStyle = th.text2; ctx.textBaseline = "middle";
      chart.data.labels.forEach((_, i) => {
        const total = chart.data.datasets.reduce((sum, d) => sum + (d.data[i] || 0), 0);
        ctx.fillText(fmt(total, i), Math.max(...metas.map((m) => m.data[i].x)) + 6, metas[0].data[i].y);
      });
      ctx.restore();
    }};
  }
  const narrow = () => matchMedia("(max-width: 960px)").matches;
  // long labels break onto two lines on phones instead of being cut at the left edge
  function twoLines(label, max = 16) {
    if (!narrow() || label.length <= max) return label;
    const mid = label.lastIndexOf(" ", Math.ceil(label.length / 2) + 2);
    return mid > 0 ? [label.slice(0, mid), label.slice(mid + 1)] : label;
  }
  function hbars(th, labels, datasets, {fmt = (v) => num(v), stacked = false, pad = 48} = {}) {
    labels = labels.map((l) => twoLines(l));
    const o = opts(th, {horizontal: true, stacked});
    o.scales.x.display = false;
    o.layout = {padding: {right: pad}};
    return {type: "bar", data: {labels, datasets}, options: o, plugins: [endLabels(th, fmt)]};
  }
  const nonEmpty = (cfg, values) => values.some((v) => v) ? cfg : null;
  function legend(el, items) {
    if (has(el.slice(1))) $(el).innerHTML = items.map(([label, color]) => `<span><i style="background:${color}"></i>${esc(label)}</span>`).join("");
  }
  function renderLegends() {
    const FLAGS = (base) => [[t("flag.ok"), base], [t("flag.outstanding"), "var(--good)"], [t("flag.negative"), "var(--critical)"]];
    const ROLES = [[t("role.received"), "var(--amber-data)"], [t("role.given"), "var(--slate)"]];
    legend("#lg-timeline", [[t("outcome.validated"), "var(--good)"], [t("outcome.failed"), "var(--critical)"], [t("outcome.in_progress"), "var(--neutral)"]]);
    legend("#lg-flags-r", FLAGS("var(--amber-data)")); legend("#lg-flags-g", FLAGS("var(--slate)"));
    legend("#lg-flags-who", [[t("flag.other"), "var(--amber-data)"], [t("flag.outstanding"), "var(--good)"]]);
    for (const id of ["#lg-role-marks", "#lg-role-cum", "#lg-role-out", "#lg-role-dur", "#lg-role-lead", "#lg-role-hour"]) legend(id, ROLES);
    legend("#lg-graph", [[t("connections.legend_received"), "var(--amber-data)"], [t("connections.legend_given"), "var(--slate)"]]);
    legend("#lg-role-where", LIGHT
      ? [[t("where.you_evaluated"), "var(--amber-data)"], [t("where.you_evaluating"), "var(--slate)"]]
      : [[t("where.corrector_evaluating"), "var(--amber-data)"], [t("where.you_evaluating"), "var(--slate)"]]);
  }

  function monthsBetween(first, last) {
    const out = []; let [y, m] = first.split("-").map(Number);
    while (`${y}-${String(m).padStart(2, "0")}` <= last) { out.push(`${y}-${String(m).padStart(2, "0")}`); [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1]; }
    return out;
  }

  // ---------- logtime ----------
  def("chMonthly", (th) => {
    const L = D.logtime, keys = Object.keys(L.monthly);
    if (!keys.length) return null;
    const ms = monthsBetween(keys[0], keys[keys.length - 1]);
    const daily = ms.length <= 2;
    $("#monthlyTitle").textContent = daily ? t("seats.day_title") : t("seats.month_title");
    const o = opts(th);
    o.plugins.tooltip.callbacks = {label: (i) => `${num(i.raw, 1)} h`};
    o.scales.y.grid.display = false;
    o.layout = {padding: {top: 24}};
    const labels = daily ? L.days.map((d) => `${+d.slice(8)} ${months()[+d.slice(5, 7) - 1]}`) : ms.map(monthLabel);
    const values = daily ? L.hours : ms.map((m) => L.monthly[m] || 0);
    return {type: "bar", data: {labels, datasets: [bar(t("unit.hours"), values, th.s1)]}, options: o, plugins: [peakLabel(th)]};
  });
  // writes the highest bar's value above it
  function peakLabel(th) {
    return {id: "peak", afterDatasetsDraw(chart) {
      const data = chart.data.datasets[0].data, i = data.indexOf(Math.max(...data));
      const el = chart.getDatasetMeta(0).data[i];
      if (!el) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = '700 15px "Barlow Semi Condensed", Barlow, sans-serif';
      ctx.fillStyle = th.ink; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText(`${num(data[i])} h · ${chart.data.labels[i]}`, Math.min(Math.max(el.x, 70), chart.width - 70), el.y - 6);
      ctx.restore();
    }};
  }

  // a computer code links to its seat on the plan above
  const seatLink = (s) => `<a class="code" href="#seat-${esc(s.host)}" title="${esc(t("computers.show_on_plan", {seat: s.host}))}">${esc(s.host)}</a>`;
  function renderLogtime() {
    const L = D.logtime;
    if (has("seats")) {
      $("#seats-title").innerHTML = `${esc(t("seats.title"))}<span class="count"><span class="sep"> · </span>${esc(plural(L.seats.length, "count.computers"))}</span>`;
      const top = L.seats[0];
      const overlap = L.seats.reduce((sum, x) => sum + x.seconds, 0) - L.total_seconds;
      $("#seats-lede").textContent = L.seats.length
        ? t(period === "all" ? "seats.lede_all" : "seats.lede_period", {total: hm(L.total_seconds), computers: plural(L.seats.length, "count.computers"), clusters: plural(Object.keys(L.clusters).length, "count.clusters")}) + " " +
          t("seats.lede_top", {seat: top.host, hours: nb(top.hours, "h"), sessions: plural(top.sessions, "count.sessions")}) +
          (overlap >= 60 ? " " + t("seats.lede_overlap", {overlap: hm(overlap)}) : "")
        : t("empty.sessions");
      const info = Object.fromEntries(L.seats.map((s) => [s.host, s]));
      seatPlan($("#planMine"), $("#planMineScale"), Object.fromEntries(L.seats.map((s) => [s.host, s.seconds])), {
        unit: "h", toUnit: (sec) => sec / 3600, anchor: true,
        detail: (h) => { const s = info[h]; return `${h} · ${nb(s.hours, "h")} · ${plural(s.sessions, "count.sessions")} · ${fmtDay(s.first)} → ${fmtDay(s.last)}`; },
      });
    }
    if (has("periods-compare")) {
      $("#compare").innerHTML = PERIOD_KEYS.map((p) => {
        const X = DATA.periods[p].logtime;
        const avgDay = X.days_present ? X.total_seconds / X.days_present : 0;
        const rows = [["periods.days", num(X.days_present)], ["periods.sessions", num(X.sessions)], ["periods.computers", num(X.seats.length)],
          ["periods.avg_day", hm(avgDay)], ["periods.longest", nb(X.longest_session_h, "h")],
          ["periods.first_day", fmtDay(X.first_day)], ["periods.last_day", fmtDay(X.last_day)]];
        return `<article class="${p === period ? "on" : ""}">
          <button type="button" data-p="${p}" aria-pressed="${p === period}"><b>${esc(periodLabel(p))}</b><span>${esc(t(p === period ? "periods.showing" : "periods.show"))}</span></button>
          <div class="v">${hmHtml(X.total_seconds)}</div>
          <dl>${rows.map(([k, v]) => `<div><dt>${esc(t(k))}</dt><dd>${v}</dd></div>`).join("")}</dl></article>`;
      }).join("");
      $("#compare").onclick = (ev) => { const b = ev.target.closest("button"); if (b) setPeriod(b.dataset.p); };
    }
    if (has("days")) {
      const busiest = L.days.reduce((best, d, i) => L.hours[i] > (best ? best[1] : 0) ? [d, L.hours[i]] : best, null);
      $("#days-lede").textContent = L.days_present
        ? t("days.lede", {days: plural(L.days_present, "count.days"), first: fmtDay(L.first_day), last: fmtDay(L.last_day), avg: hm(L.total_seconds / L.days_present),
          longest: nb(L.longest_session_h, "h"), busiest: fmtDay(busiest[0], {weekday: "long", day: "numeric", month: "long", year: "numeric"}), busiest_h: nb(busiest[1], "h")})
        : t("empty.sessions");
      calendar($("#calendar"), $("#calendarScale"), L.days, L.hours);
      $(".cal-scroll").scrollLeft = $(".cal-scroll").scrollWidth;  // narrow screens open on the latest months
      heat($("#heatPresence"), L.heat, AMBER, "h");
    }
    if (has("computers")) {
      const top = L.seats[0];
      $("#computers-lede").textContent = L.seats.length
        ? t("computers.lede", {computers: plural(L.seats.length, "count.computers"), seat: top.host, hours: nb(top.hours, "h")})
        : t("empty.computers");
      const max = top ? top.hours : 1;
      const part = (s, i) => (s.host.match(/^c(\d+)r(\d+)s(\d+)$/) || [])[i];
      makeTable($("#tblSeats"), [
        {k: "host", t: t("col.computer"), f: seatLink},
        {k: "cluster", t: t("col.cluster"), num: true, hide: true, sv: (s) => +part(s, 1), f: (s) => part(s, 1) ?? "–"},
        {k: "row", t: t("col.row"), num: true, hide: true, sv: (s) => +part(s, 2), f: (s) => part(s, 2) ?? "–"},
        {k: "seat", t: t("col.seat"), num: true, hide: true, sv: (s) => +part(s, 3), f: (s) => part(s, 3) ?? "–"},
        {k: "hours", t: t("col.hours"), num: true, nw: true, f: (s) => `<span class="hbar" aria-hidden="true"><i style="width:${(100 * s.hours / max).toFixed(1)}%"></i></span>${s.hours.toFixed(1)}`},
        {k: "sessions", t: t("col.sessions"), num: true},
        {k: "first", t: t("col.first"), nw: true, hide: true, f: (s) => esc(s.first)},
        {k: "last", t: t("col.last"), nw: true, hide: true, f: (s) => esc(s.last)},
      ], L.seats, {sort: ["hours", -1]});
    }
    if (has("sessions")) drawSessions();
  }
  function drawSessions() {
    const q = $("#sessionSearch").value.trim().toLowerCase();
    const rows = D.logtime.log.filter((s) => !q || `${s.begin} ${s.end} ${s.host}`.toLowerCase().includes(q));
    $("#sessionCount").textContent = t("sessions.count", {shown: num(rows.length), total: num(D.logtime.log.length)});
    makeTable($("#tblSessions"), [
      {k: "begin_ms", t: t("col.logged_in"), nw: true, f: (s) => esc(s.begin)},
      {k: "seconds", t: t("col.duration"), num: true, nw: true, f: (s) => hm(s.seconds)},
      {k: "host", t: t("col.computer"), f: seatLink},
      {k: "end", t: t("col.logged_out"), nw: true, hide: true, f: (s) => s.end ? esc(s.end) : esc(t("sessions.still_logged"))},
    ], rows, {sort: ["begin_ms", -1], empty: q ? t("empty.search_sessions") : t("empty.sessions")});
  }
  if (has("sessions")) $("#sessionSearch").oninput = drawSessions;

  // ---------- report sections ----------
  const mostOutstanding = () => D.people.filter((p) => p.outstanding_to_me).sort((a, b) => b.outstanding_to_me - a.outstanding_to_me)[0];
  function renderSummary() {
    const S = D.summary;
    $("#summary-lede").textContent = t("summary.lede", {validated: S.validated, projects: S.projects, attempts: S.attempts, retries: S.retries,
      retried: S.projects_with_retries, received: S.received, correctors: S.unique_correctors, outstanding: S.received_outstanding,
      pct: pct(S.received_outstanding, S.received), given: S.given, evaluated: S.unique_evaluated, mutual: S.mutual});
    const lead = [
      ["summary.k_validated", `${S.validated}<small> / ${S.projects}</small>`, t("summary.s_validated", {attempts: S.attempts, retries: S.retries})],
      ["summary.k_received", num(S.received), t("summary.s_avg", {mark: num(S.received_avg_mark, 1)})],
      ["summary.k_given", num(S.given), t("summary.s_avg", {mark: num(S.given_avg_mark, 1)})],
      ["summary.k_outstanding", num(S.received_outstanding), t("summary.s_outstanding", {pct: pct(S.received_outstanding, S.received)})],
    ];
    $("#lead").innerHTML = lead.map(([k, v, s]) => `<div><p class="k">${esc(t(k))}</p><p class="v">${v}</p><p class="s">${esc(s)}</p></div>`).join("");
    const cursus = D.extras.cursus.map((c) => `${c.name} ${num(c.level, 2)}`).join(" · ");
    const mostOut = mostOutstanding();
    const sub = (key, vars) => `<span>${esc(t(key, vars))}</span>`;
    const facts = [
      ["summary.f_level", esc(cursus) || "–"],
      ["summary.f_logged", `${hm(D.logtime.total_seconds)}${sub("summary.f_logged_sub", {days: plural(D.logtime.days_present, "count.days")})}`],
      ["summary.f_outstanding_given", `${S.given_outstanding}${sub("summary.f_negative_sub", {n: S.given_negative})}`],
      ["summary.f_correctors", `${S.unique_correctors}${mostOut ? sub("summary.f_most_sub", {login: mostOut.login, n: mostOut.outstanding_to_me}) : ""}`],
      ["summary.f_mutual", S.mutual],
      ["summary.f_median", `${t("unit.min", {n: num(D.when.median_duration_received)})}${sub("summary.f_median_sub", {n: num(D.when.median_duration_given)})}`],
      ["summary.f_noshows", `${S.truant_me + S.truant_others}${sub("summary.f_noshows_sub", {mine: S.truant_me, others: S.truant_others})}`],
      ["summary.f_rating", `${num(S.ratings_i_received.rating, 2)}${sub("summary.f_rating_sub", {})}`],
      ["summary.f_wallet", `${num(P.wallet)} ₳`],
      ["summary.f_points", num(P.correction_point)],
    ];
    $("#facts").innerHTML = facts.map(([k, v]) => `<div><dt>${esc(t(k))}</dt><dd>${v}</dd></div>`).join("");
  }

  let attemptOfTeam = {}, retryBars = [];
  function renderProjects() {
    attemptOfTeam = {};
    for (const p of D.projects) for (const a of p.attempts) attemptOfTeam[a.team_id] = a.n;
    $("#timeline-box").style.height = Math.max(240, D.projects.length * 22 + 60) + "px";
    // sized here, not when the chart is drawn, so lazy charts never shift the page
    const retried = D.projects.filter((p) => p.retries).sort((a, b) => b.retries - a.retries);
    const many = retried.filter((p) => p.retries > 1);
    retryBars = many.length >= 3 ? many : retried;
    const once = retried.filter((p) => !retryBars.includes(p));
    $("#retriesNote").textContent = once.length ? t("projects.retried_once", {count: once.length, n: num(once.length), list: once.map((p) => p.name).join(", ")}) : "";
    $("#chRetries").parentElement.style.height = Math.max(200, retryBars.length * (narrow() ? 32 : 24) + 20) + "px";
  }

  const markChip = (a) => {
    const state = a.validated === true ? "pass" : a.validated === false ? "fail" : a.mark == null ? "open" : "";
    const title = [t("projects.attempt_title", {n: a.n}) + (a.validated === true ? `, ${t("outcome.validated").toLowerCase()}` : a.validated === false ? `, ${t("outcome.failed").toLowerCase()}` : ""),
      a.start, a.members.length ? t("projects.with", {list: a.members.join(", ")}) : "",
      a.moulinette.length ? t("projects.moulinette", {marks: a.moulinette.map((m) => m.mark).join(", ")}) : ""].filter(Boolean).join(" · ");
    return `<span class="mark ${state}" title="${esc(title)}">${a.mark ?? esc(t("projects.pending"))}</span>`;
  };

  function renderHomeKpis() {
    const S = D.summary, L = D.logtime, top = L.seats[0];
    const clusters = Object.entries(L.clusters).map(([c, h]) => `${c}\u00a0${nb(h, "h", 0)}`).join(" · ");
    const level = D.extras.cursus.find((c) => c.name === "42cursus") || D.extras.cursus[0];
    const rank = myRank(D.extras);
    const xp = D.projects.reduce((sum, p) => sum + (p.xp_earned || 0), 0);
    const finished = D.projects.filter((p) => p.mark != null);
    const failed = D.stats?.failed_given;
    const line = (s) => `<p class="s">${s}</p>`;
    const group = (key, big, lines) => `<div><h3>${esc(t(key))}</h3><p class="v">${big}</p>${lines.filter(Boolean).map(line).join("")}</div>`;
    $("#kpis").innerHTML = [
      group("home.k_projects", `${S.validated}<small> / ${S.projects}</small>`, [esc(t("home.attempts", {attempts: S.attempts, retries: S.retries})),
        finished.length ? esc(t("home.avg_mark", {mark: num(finished.reduce((a, p) => a + p.mark, 0) / finished.length, 1)})) : ""]),
      group("home.k_level", level ? `${num(level.level, 2)}<small> ${esc(t("home.level"))}</small>` : "–",
        [esc(rank ? t("home.rank", {rank: t(`groups.${rank}`)}) : t("home.no_cursus")), esc(t("home.xp", {xp: num(xp)}))]),
      group("home.k_evals", num(S.received), [esc(t("home.given", {n: S.given})),
        esc(t("home.out", {received: S.received_outstanding, given: S.given_outstanding})),
        failed && failed.pct != null ? esc(t("home.failed", {pct: `${num(failed.pct, 1)}%`})) : ""]),
      // the hours themselves are in the rail; here the place: the most used seat
      group("home.k_seat", top ? esc(top.host) : "–", [top ? esc(t("home.seat_hours", {hours: nb(top.hours, "h")})) : "",
        esc(t("home.days", {days: plural(L.days_present, "count.days")})), clusters ? esc(t("home.clusters", {list: clusters})) : ""]),
    ].join("");
  }

  // the projects table: track, name search, mark, year, grouping by rank, CSV of what is shown
  const proj = {track: "student", search: "", marks: "all", year: "all", grouped: false};
  const groupLabel = (g) => g === "piscine" ? t("track.piscine") : t(`groups.${g}`);
  let projRows = [];
  function renderTrackTable() {
    const all = (DATA.periods.all || D).projects;
    const years = [...new Set(all.map((p) => (p.marked || p.registered || "").slice(0, 4)).filter(Boolean))].sort().reverse();
    const sel = $("#projYear");
    if (sel.options.length !== years.length + 1) {
      sel.innerHTML = `<option value="all">${esc(t("projects_table.year_all"))}</option>` + years.map((y) => `<option>${y}</option>`).join("");
      sel.value = years.includes(proj.year) ? proj.year : "all";
      if (sel._refresh) sel._refresh();  // the custom listbox (controls.js) shows the new options
    }
    const rows = projRows = projectView(all, proj);
    $("#trackCount").textContent = plural(rows.length, "projects_table.count");
    const evalLine = (e) => `<li><span class="code">${esc(e.corrector)}</span> <span class="mark ${e.mark == null ? "open" : e.negative || e.mark < 50 ? "fail" : "pass"}">${e.mark ?? "–"}</span>` +
      `${e.outstanding ? ` <span class="badge out">${esc(t("flag.outstanding"))}</span>` : e.negative ? ` <span class="badge bad">${esc(e.flag)}</span>` : ""} <span class="note">${esc(e.begin || "")}</span></li>`;
    const detail = (p) => !p.attempts.length ? "" : `<details><summary>${esc(t("projects_table.detail", {count: p.attempts.length, n: p.attempts.length}))}</summary><ol class="attempts">` +
      p.attempts.map((a) => `<li><p><b>${esc(t("projects.attempt_title", {n: a.n}))}</b> ${markChip(a)} <span class="note">${esc(a.start)} → ${esc(a.closed || a.locked || t("projects.tip_open"))}</span></p>` +
        `<p class="note">${esc(a.members.length ? t("projects_table.team", {list: a.members.join(", ")}) : t("projects_table.solo"))}</p>` +
        (a.evaluations.length ? `<ul class="evals">${a.evaluations.map(evalLine).join("")}</ul>` : `<p class="note">${esc(t("projects_table.no_evals"))}</p>`) + "</li>").join("") + "</ol></details>";
    makeTable($("#tblTrack"), [
      {k: "name", t: t("col.project"), cls: "proj", f: (p) => `${esc(p.name)}${p.exam ? ` <span class="badge">${esc(t("projects.exam"))}</span>` : ""}`},
      {k: "track", t: t("col.track"), nw: true, hide: true, f: (p) => `<span class="badge">${esc(t(`track.${p.track}`))}</span>`},
      {k: "status", t: t("col.status"), nw: true, hide: true, f: (p) => esc(t(`status.${p.status}`) === `status.${p.status}` ? (p.status || "").replace(/_/g, " ") : t(`status.${p.status}`))},
      {k: "mark", t: t("col.final"), num: true},
      {k: "attempts", t: t("col.attempts"), cls: "marks-col", sv: (p) => p.attempts.length,
        f: (p) => `<span class="marks">${p.attempts.map((a, i) => i ? `<span class="step">→${markChip(a)}</span>` : markChip(a)).join("")}</span>`},
      {k: "outstanding", t: t("col.outstanding"), num: true},
      {k: "xp_earned", t: t("col.xp"), num: true, nw: true, f: (p) => `${num(p.xp_earned)}<span class="sub">${esc(t("projects_table.xp_base", {xp: num(p.xp_base)}))}</span>`},
      {k: "first_ms", t: t("col.started"), nw: true, hide: true, f: (p) => esc((p.registered || "").slice(0, 10))},
    ], rows, {sort: ["first_ms", -1], sticky: true, detail, empty: t("projects_table.none"),
      group: proj.grouped ? {key: (p) => p.group || p.track, order: PROJECT_GROUPS, label: groupLabel} : null});
  }
  if (has("projects-table")) {
    $("#trackFilter").onclick = (ev) => {
      const b = ev.target.closest("button"); if (!b) return;
      proj.track = b.dataset.v;
      $$("#trackFilter button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      renderTrackTable(); hintScroll();
    };
    $("#projSearch").oninput = (ev) => { proj.search = ev.target.value; renderTrackTable(); hintScroll(); };
    $("#projMarks").onchange = (ev) => { proj.marks = ev.target.value; renderTrackTable(); hintScroll(); };
    $("#projYear").onchange = (ev) => { proj.year = ev.target.value; renderTrackTable(); hintScroll(); };
    $("#projGroup").onclick = (ev) => {
      proj.grouped = !proj.grouped; ev.currentTarget.setAttribute("aria-pressed", String(proj.grouped)); renderTrackTable(); hintScroll();
    };
    $("#projCsv").onclick = () => {
      const csv = toCSV(projRows, [
        {k: "name", t: t("col.project")}, {k: "track", t: t("col.track"), csv: (p) => t(`track.${p.track}`)},
        {k: "group", t: t("col.group"), csv: (p) => groupLabel(p.group || p.track)}, {k: "status", t: t("col.status")},
        {k: "mark", t: t("col.final")}, {k: "attempts", t: t("col.attempts"), csv: (p) => p.attempts.length},
        {k: "outstanding", t: t("col.outstanding")}, {k: "xp_earned", t: t("col.xp")},
        {k: "registered", t: t("col.started"), csv: (p) => (p.registered || "").slice(0, 10)},
        {k: "marked", t: t("col.marked"), csv: (p) => (p.marked || "").slice(0, 10)}]);
      const a = Object.assign(document.createElement("a"), {href: URL.createObjectURL(new Blob([csv], {type: "text/csv"})),
        download: `projects-${proj.track}.csv`});
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  }

  // ---------- skills: radar (default) or bars, for the 42cursus (default) or the C Piscine ----------
  let skillCursus = "42cursus", skillView = "radar";
  const skillItems = () => (D.extras.skills_by_cursus || {})[skillCursus] || (skillCursus === "42cursus" ? D.extras.skills : []);
  const skillBars = () => skillItems().filter((s) => s.level > 0).sort((a, b) => b.level - a.level);
  function renderSkills() {
    $$("#skillCursus button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === skillCursus)));
    $$("#skillView button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === skillView)));
    const radar = skillView === "radar";
    $("#skillRadar").hidden = !radar; $("#skillBars").hidden = radar;
    const compact = $("#skillRadar").parentElement.clientWidth < 520;
    $("#skillRadar").classList.toggle("compact", compact);
    if (radar && window.drawRadar) drawRadar($("#skillRadar"), skillItems(), {fmt: (v) => num(v, 2), label: t("extras.skills_title"), compact});
    $("#skillKey").hidden = !(radar && compact);
    if (radar && compact && window.radarKey) radarKey($("#skillKey"), skillItems(), {fmt: (v) => num(v, 2)});
    if (!radar) {
      $("#skillBars").style.height = Math.max(200, skillBars().length * (narrow() ? 34 : 26) + 30) + "px";
      if (charts.has("chSkills")) { charts.get("chSkills").destroy(); charts.delete("chSkills"); }
      if (window.Chart) buildChart("chSkills");
    }
  }
  if (has("extras")) {
    let skillWidth = 0;
    addEventListener("resize", () => {
      const w = $("#skillRadar").parentElement.clientWidth;
      if (Math.abs(w - skillWidth) > 40 && skillView === "radar") { skillWidth = w; renderSkills(); }
    }, {passive: true});
    $("#skillCursus").onclick = (ev) => { const b = ev.target.closest("button"); if (b) { skillCursus = b.dataset.v; renderSkills(); } };
    $("#skillView").onclick = (ev) => { const b = ev.target.closest("button"); if (b) { skillView = b.dataset.v; renderSkills(); } };
  }

  // ---------- extra views: coalitions and promo, pace, exams, teammates, evaluations in depth ----------
  const factList = (rows) => rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("");
  function renderStanding() {
    const C = DATA.coalitions || [], promo = DATA.promo;
    $("#standing").hidden = !C.length && !promo;
    const top = Math.max(1, ...C.map((c) => c.score));
    $("#coalitionList").innerHTML = C.map((c) => `<li class="${c.mine ? "mine" : ""}"><span class="rank">${c.rank}</span>` +
      `<span class="name"><i style="background:${safeColor(c.color)}"></i>${esc(c.name)}${c.mine ? ` <span class="badge">${esc(t("standing.yours"))}</span>` : ""}</span>` +
      `<span class="track"><b style="width:${(100 * c.score / top).toFixed(1)}%;background:${safeColor(c.color)}"></b></span><span class="num">${num(c.score)}</span></li>`).join("");
    $("#promoLede").textContent = promo ? t("standing.promo_lede", {rank: num(promo.rank), size: num(promo.size), pct: num(promo.percentile, 1), median: num(promo.median, 2)})
      : t("standing.no_promo");
  }
  function renderPace() {
    const pc = (D.insights || {}).pace;
    $("#pace").hidden = !pc;
    if (!pc) return;
    $("#paceFacts").innerHTML = factList([
      [t("pace.since"), pc.months_since_kickoff != null ? esc(plural(pc.months_since_kickoff, "pace.months")) : "–"],
      [t("pace.xp_month"), pc.xp_per_month != null ? esc(num(pc.xp_per_month)) : "–"],
      [t("pace.validated"), esc(num(pc.months.reduce((a, m) => a + m.validated, 0)))],
      [t("pace.blackhole"), esc(pc.blackhole_days == null ? t("pace.no_blackhole") : plural(pc.blackhole_days, "pace.days_left"))]]);
  }
  function renderExams() {
    const ex = (D.insights || {}).exams || [];
    makeTable($("#tblExams"), [
      {k: "name", t: t("col.exam"), nw: true},
      {k: "passed", t: t("col.status"), nw: true, sv: (e) => e.passed ? 1 : 0, f: (e) => `<span class="badge ${e.passed ? "out" : ""}">${esc(t(e.passed ? "exams.passed" : "exams.pending"))}</span>`},
      {k: "attempts", t: t("col.attempts"), num: true},
      {k: "best", t: t("col.best"), num: true},
      {k: "days_to_pass", t: t("col.days_to_pass"), num: true, f: (e) => e.days_to_pass == null ? "–" : esc(num(e.days_to_pass))},
      {k: "tries", t: t("col.tries"), sv: (e) => e.tries.length, f: (e) => `<span class="marks">${e.tries.map((x) =>
        `<span class="mark ${x.passed ? "pass" : "fail"}" title="${esc(fmtDay(x.date))}">${x.mark ?? "–"}</span>`).join("")}</span>`},
    ], ex, {sort: ["name", 1], empty: t("exams.none")});
  }
  function renderTeammates() {
    const tm = (D.insights || {}).teammates || [];
    makeTable($("#tblTeammates"), [
      {k: "login", t: t("col.login"), nw: true},
      {k: "name", t: t("col.name"), hide: true, f: (r) => esc(r.name || "")},
      {k: "teams", t: t("col.teams"), num: true},
      {k: "projects", t: t("col.projects"), sv: (r) => r.projects.length, f: (r) => esc(r.projects.join(", "))},
    ], tm, {sort: ["teams", -1], empty: t("teammates.none")});
  }
  function renderDepth() {
    const dp = (D.insights || {}).evaluations;
    $("#depth").hidden = !dp;
    if (!dp) return;
    const dur = (d) => d.avg == null ? "–" : t("depth.minutes", {avg: num(d.avg), median: num(d.median)});
    $("#depthFacts").innerHTML = factList([
      [t("depth.received_duration"), esc(dur(dp.received_duration))], [t("depth.given_duration"), esc(dur(dp.given_duration))],
      [t("depth.lead"), esc(dp.received_lead_h == null ? "–" : t("depth.hours", {h: num(dp.received_lead_h, 1)}))],
      [t("depth.streak"), esc(num(dp.outstanding_streak))]]);
    makeTable($("#tblDepth"), [
      {k: "project", t: t("col.project"), nw: true},
      {k: "received", t: t("col.received"), num: true}, {k: "received_avg", t: t("col.avg_received"), num: true, f: (r) => esc(num(r.received_avg, 1))},
      {k: "received_outstanding", t: t("col.outstanding"), num: true},
      {k: "given", t: t("col.given"), num: true}, {k: "given_avg", t: t("col.avg_given"), num: true, hide: true, f: (r) => esc(num(r.given_avg, 1))},
    ], dp.projects, {sort: ["received", -1]});
  }
  function renderFooter() {
    const C = D.campuses || [];
    $("#footCampus").innerHTML = C.length ? `<h2 class="foot-title">${esc(t("foot.campuses"))}</h2><ul class="campuses">${C.map((c) =>
      `<li><p><b>${esc(c.name || "?")}</b>${c.primary ? ` <span class="badge">${esc(t("foot.current"))}</span>` : ""}${c.city ? ` <span class="note">${esc(c.city)}</span>` : ""}</p>` +
      `<p>${esc(t("foot.joined", {when: fmtDay(c.joined)}))}${c.sessions ? ` · ${esc(t("foot.time", {hours: num(c.hours, 1), sessions: num(c.sessions)}))}` : ` · ${esc(t("foot.no_sessions"))}`}</p>` +
      (c.first ? `<p class="note">${esc(t("foot.span", {first: fmtDay(c.first), last: fmtDay(c.last)}))}</p>` : "") + `</li>`).join("")}</ul>` : "";
  }

  function renderCorrectionStats() {
    const st = D.stats;
    if (!st) return;
    const rate = (r, key) => `<div><p class="v">${r.pct == null ? "–" : `${num(r.pct, 1)}<small>%</small>`}</p><p class="k">${esc(t(key))}</p>` +
      `<p class="s">${esc(t("stats.of", {n: r.n, total: r.total}))}</p></div>`;
    const R = st.outstanding_reciprocity;
    $("#rates").innerHTML = rate(st.failed_given, "stats.failed_given") + rate(st.failed_received, "stats.failed_received") +
      `<div><h3>${esc(t("stats.reciprocity_title"))}</h3><p class="s">${esc(t("stats.recip_in", {back: R.i_gave_back, gave_me: R.gave_me}))}</p>` +
      `<p class="s">${esc(t("stats.recip_out", {back: R.they_gave_back, i_gave: R.i_gave}))}</p></div>`;
    const groups = Object.entries(st.by_group || {});
    const panel = document.querySelector('[data-panel="by-group"]');
    if (panel) panel.hidden = !groups.length;
    if (groups.length) {
      const order = ["rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06", "outer-core", "alumni", "no-cursus"];
      const rows = groups.map(([g, v]) => ({g, ...v, i: order.indexOf(g), in_pct: v.received ? 100 * v.received_out / v.received : null, out_pct: v.given ? 100 * v.given_out / v.given : null}));
      makeTable($("#tblGroups"), [
        {k: "i", t: t("col.group"), f: (r) => esc(t(`groups.${r.g}`))},
        {k: "received", t: t("col.received"), num: true}, {k: "in_pct", t: t("col.out_pct"), num: true, f: (r) => r.in_pct == null ? "–" : `${num(r.in_pct, 0)}%`},
        {k: "given", t: t("col.given"), num: true}, {k: "out_pct", t: t("col.out_pct"), num: true, f: (r) => r.out_pct == null ? "–" : `${num(r.out_pct, 0)}%`},
      ], rows, {sort: ["i", 1]});
    }
  }

  const firstOf = (list, n) => list.length > n ? t("common.first_of", {list: list.slice(0, n).join(", "), more: list.length - n}) : list.join(", ");
  const peopleCols = () => [
    {k: "login", t: t("col.login"), nw: true, f: (p) => `${avatar(p)}${esc(p.login)}${p.staff ? ` <span class="badge">${esc(t("who.staff"))}</span>` : ""}`},
    {k: "name", t: t("col.name"), cls: "name", hide: true, f: (p) => `<span title="${esc(p.name)}">${esc(p.name ?? "")}</span>`},
    {k: "evaluated_me", t: t("col.evaluated_you"), num: true},
    {k: "outstanding_to_me", t: t("col.outstanding"), num: true},
    {k: "avg_mark_to_me", t: t("col.avg_mark"), num: true, hide: true},
    {k: "evaluated_by_me", t: t("col.you_evaluated"), num: true},
    {k: "teammate", t: t("col.teammate"), num: true, hide: true},
    {k: "my_rating_of_them", t: t("col.ratings"), num: true, nw: true, hide: true, f: (p) => `${num(p.my_rating_of_them, 2)} / ${num(p.their_rating_of_me, 2)}`},
    {k: "projects_on_me", t: t("col.details"), cls: "details", hide: true, sv: (p) => Object.keys(p.projects_on_me).length, f: (p) => {
      const projects = Object.entries(p.projects_on_me).map(([k, v]) => v > 1 ? `${k} ×${v}` : k);
      const seats = Object.keys(p.hosts);
      const line = [seats.length ? t("who.seats", {list: firstOf(seats, 2)}) : "", p.first ? `${p.first.slice(0, 10)} → ${p.last.slice(0, 10)}` : ""].filter(Boolean).join(" · ");
      return `<span title="${esc(projects.join(", "))}">${esc(firstOf(projects, 3) || "–")}</span>${line ? `<span class="sub" title="${esc(seats.join(", "))}">${esc(line)}</span>` : ""}`;
    }},
  ];
  let peopleTable;
  const filterPeople = (q) => D.people.filter((p) => !q || JSON.stringify([p.login, p.name, p.projects_on_me, p.hosts]).toLowerCase().includes(q));
  function renderWho() {
    const S = D.summary;
    const mostOut = mostOutstanding();
    $("#who-lede").textContent = t("who.lede", {correctors: S.unique_correctors, mutual: S.mutual}) +
      (mostOut ? " " + t("who.lede_most", {login: mostOut.login, n: mostOut.outstanding_to_me}) : "");
    $("#who-box").style.height = Math.max(240, Math.min(25, D.people.filter((p) => p.evaluated_me).length) * 24 + 60) + "px";
    peopleTable = makeTable($("#tblPeople"), peopleCols(), filterPeople($("#peopleSearch").value.toLowerCase()), {sort: ["evaluated_me", -1], sticky: true});
  }
  if (has("who")) $("#peopleSearch").oninput = (ev) => peopleTable.set(filterPeople(ev.target.value.toLowerCase()));

  function renderLedes() {
    const S = D.summary, W = D.when, PL = D.place, CP = D.correction_points;
    if (has("received")) $("#received-lede").textContent = t("received.lede", {n: S.received, mark: num(S.received_avg_mark, 1),
      outstanding: S.received_outstanding, pct: pct(S.received_outstanding, S.received), negative: S.received_negative});
    if (has("when")) {
      $("#when-lede").textContent = t("when.lede", {recv: num(W.median_duration_received), given: num(W.median_duration_given), lead: num(W.median_lead_received, 1)});
      heat($("#heatRecv"), W.heat_received, AMBER, t("unit.evaluations"));
      heat($("#heatGiven"), W.heat_given, SLATE, t("unit.evaluations"));
    }
    if (has("where")) $("#where-lede").textContent = LIGHT
      ? t("where.lede_light", {me: PL.me_located_received, n: S.received, given: PL.me_located_given, total_given: S.given})
      : t("where.lede", {corrector: PL.corrector_located, n: S.received, me: PL.me_located_received, same: PL.same_cluster});
    if (has("given")) $("#given-lede").textContent = t("given.lede", {n: S.given, mark: num(S.given_avg_mark, 1), outstanding: S.given_outstanding,
      negative: S.given_negative, rating: num(S.ratings_i_received.rating, 2)});
    if (has("points")) {
      $("#points-lede").textContent = CP.series.length ? t("points.lede", {earned: CP.earned, spent: CP.spent, max: CP.max}) : t("empty.points");
      makeTable($("#tblReasons"), [{k: "reason", t: t("col.reason")}, {k: "count", t: t("col.times"), num: true}, {k: "sum", t: t("col.net"), num: true}],
        Object.entries(CP.reasons).map(([reason, v]) => ({reason, ...v})), {sort: ["count", -1]});
    }
  }

  // In light data the corrector's seat is unknown: the plan shows only the user's own seat
  let whereRole = LIGHT ? "mine" : "corrector";
  function renderWhere() {
    const PL = D.place;
    const values = whereRole === "corrector" ? PL.received_corrector_hosts : PL.my_eval_hosts;
    const who = t(whereRole === "corrector" ? "where.tip_corrector" : "where.tip_mine");
    seatPlan($("#planWhere"), $("#planWhereScale"), values, {unit: t("unit.evals"), detail: (h, v) => `${h} · ${plural(v, "count.evaluations")} · ${who}`});
  }
  if (has("where")) {
    $("#whereControls").hidden = LIGHT;
    $("#whereRole").onclick = (ev) => {
      const b = ev.target.closest("button"); if (!b) return;
      whereRole = b.dataset.v;
      $$("#whereRole button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      renderWhere();
    };
  }

  const KINDS = ["nice", "rigorous", "interested", "punctuality"];
  function renderFeedback() {
    const S = D.summary;
    const mine = D.received.flatMap((e) => e.feedbacks.filter((f) => f.by === P.login));
    const theirs = D.given.flatMap((e) => e.feedbacks);
    const below = (fbs, k, max) => fbs.filter((f) => f[k] != null && f[k] < max).length;
    const panel = document.querySelector('[data-panel="table-feedback"]');
    if (panel) panel.hidden = LIGHT;
    if (!LIGHT) {
      const rows = [["overall", "rating", 5], ...KINDS.map((k) => [k, k, 4])]
        .map(([label, k, max]) => ({label: `${t(`criterion.${label}`)} (/${max})`, mineAvg: S.my_rating_of_correctors[k], mineLow: below(mine, k, max),
          theirAvg: S.ratings_i_received[k], theirLow: below(theirs, k, max)}));
      makeTable($("#tblFeedback"), [
        {k: "label", t: t("col.criterion")},
        {k: "mineAvg", t: t("col.you_to_correctors", {n: mine.length}), num: true, f: (r) => `${num(r.mineAvg, 2)}<span class="sub">${esc(t("feedback.below_max", {n: r.mineLow}))}</span>`},
        {k: "theirAvg", t: t("col.evaluated_to_you", {n: theirs.length}), num: true, f: (r) => `${num(r.theirAvg, 2)}<span class="sub">${esc(t("feedback.below_max", {n: r.theirLow}))}</span>`},
      ], rows);
    }
    const rated = D.given.flatMap((e) => e.feedbacks.map((f) => ({...f, project: e.project, begin: e.begin}))).filter((f) => f.rating != null);
    const low = rated.filter((f) => f.rating < 5 || KINDS.some((k) => f[k] != null && f[k] < 4))
      .sort((a, b) => a.rating - b.rating || KINDS.reduce((sum, k) => sum + (a[k] ?? 4) - (b[k] ?? 4), 0));
    $("#lowFeedbackNote").textContent = rated.length ? t("feedback.low_note", {low: low.length, ratings: plural(rated.length, "count.ratings")}) : "";
    $("#lowFeedback").innerHTML = low.map((f) => {
      const crit = KINDS.filter((k) => f[k] != null && f[k] < 4).map((k) => `${t(`criterion.${k}`)} ${f[k]}/4`).join(" · ");
      return `<li><span><b>${f.rating}/5</b>${crit ? ` · ${esc(crit)}` : ""} · ${esc(t("feedback.by", {login: f.by || "?", project: f.project}))}<br><span class="note">${esc(f.comment)}</span></span><span class="when">${esc(f.begin.slice(0, 10))}</span></li>`;
    }).join("") || `<li class="note">${esc(t(rated.length ? "feedback.all_max" : "empty.ratings"))}</li>`;
  }

  const eventKind = (k) => t(`event.${k}`) === `event.${k}` ? String(k).replace(/_/g, " ") : t(`event.${k}`);
  function renderExtras() {
    const X = D.extras;
    const none = `<li class="note">${esc(t("empty.period"))}</li>`;
    $("#lstAchievements").innerHTML = X.achievements.slice().reverse().map((a) =>
      `<li><span><b>${esc(a.name)}</b>${a.tier && a.tier !== "none" ? ` <span class="badge">${esc(a.tier)}</span>` : ""}<br><span class="note">${esc(a.description)}</span></span><span class="when">${esc(a.at.slice(0, 10))}</span></li>`).join("") || none;
    $("#eventKinds").textContent = Object.entries(X.event_kinds).map(([k, v]) => `${eventKind(k)}: ${v}`).join(" · ");
    $("#lstEvents").innerHTML = X.events.slice().reverse().map((e) =>
      `<li><span>${esc(e.name)}<br><span class="note">${esc(eventKind(e.kind))}${e.location ? " · " + esc(e.location) : ""}${e.hours ? " · " + e.hours + " h" : ""}</span></span><span class="when">${esc(e.begin)}</span></li>`).join("") || none;
    $("#lstMisc").innerHTML = [
      ...X.quests.map((q) => `<li><span><b>${esc(t("extras.quest"))}</b> ${esc(q.name)}<br><span class="note">${esc(q.description)}</span></span><span class="when">${esc((q.validated || t("extras.in_progress")).slice(0, 10))}</span></li>`),
      ...X.titles.map((x) => `<li><span><b>${esc(t("extras.title_item"))}</b> ${esc(x.name)}${x.selected ? ` <span class="badge">${esc(t("extras.selected"))}</span>` : ""}</span><span class="when">${esc(x.at.slice(0, 10))}</span></li>`),
      ...X.expertises.map((x) => `<li><span><b>${esc(t("extras.expertise"))}</b> ${esc(x.name)}</span><span class="when">${x.value} / 5</span></li>`),
    ].join("") || none;
  }

  // evaluation log
  function fbText(e) {
    if (!e.comment && !e.feedbacks.length) return "";
    const parts = [];
    if (e.comment) parts.push(`<div class="txt"><b>${esc(t("log.corrector_comment"))}</b>\n${esc(e.comment)}</div>`);
    for (const f of e.feedbacks) {
      const kinds = KINDS.filter((k) => f[k] != null).map((k) => `${t(`criterion.${k}`)} ${f[k]}/4`).join(" · ");
      parts.push(`<div class="txt"><b>${esc(t("log.feedback_by", {login: f.by || "?", rating: f.rating ?? "–"}))}</b>${kinds ? ` <span class="note">${esc(kinds)} · ${esc(f.at)}</span>` : ""}\n${esc(f.comment)}</div>`);
    }
    const what = e.comment && e.feedbacks.length ? t("log.comment_and_feedback", {count: e.feedbacks.length, n: e.feedbacks.length})
      : e.comment ? t("log.comment_only") : t("log.feedback_only", {count: e.feedbacks.length, n: e.feedbacks.length});
    const preview = (e.comment || e.feedbacks[0]?.comment || "").replace(/\s+/g, " ").slice(0, 140);
    return `<details><summary>${esc(what)}<span class="preview">${esc(preview)}</span></summary>${parts.join("")}</details>`;
  }
  const logCols = () => {
    const flagCol = {k: "flag", t: t("col.flag"), nw: true, sv: (e) => e.outstanding ? 2 : e.negative_flag ? 0 : 1, f: flagBadge};
    const minCol = {k: "duration_min", t: t("col.minutes"), num: true, nw: true, hide: true,
      f: (e) => `${num(e.duration_min)} <span class="note">/ ${e.planned_min}</span>${e.lead_h != null ? `<span class="sub">${esc(t("log.booked_ahead", {h: num(e.lead_h, 1)}))}</span>` : ""}`};
    const mySeat = (e) => esc(e.my_host || t("log.not_logged"));
    return {
      received: [
        {k: "begin_ms", t: t("col.when"), nw: true, f: (e) => esc(e.begin)},
        {k: "project", t: t("col.project"), nw: true, f: (e) => `${esc(e.project)}<span class="sub">${esc(t("projects.attempt", {n: attemptOfTeam[e.team_id] ?? "?"}))}</span>`},
        {k: "corrector", t: t("col.corrector"), nw: true, sv: (e) => e.corrector.login, f: (e) => `${avatar(e.corrector)}${esc(e.corrector.login)}`},
        LIGHT ? {k: "my_host", t: t("col.your_seat"), nw: true, hide: true, f: mySeat}
          : {k: "other_host", t: t("col.seats"), nw: true, hide: true, f: (e) => `${esc(e.other_host || (e.other_host_checked ? t("log.not_logged") : "–"))}<span class="sub">${esc(t("log.you_seat", {seat: e.my_host || t("log.not_logged")}))}</span>`},
        minCol, {k: "mark", t: t("col.mark"), num: true}, flagCol,
        {k: "fb_rating", t: t("col.your_rating"), num: true, hide: true},
      ],
      given: [
        {k: "begin_ms", t: t("col.when"), nw: true, f: (e) => esc(e.begin)},
        {k: "project", t: t("col.project"), nw: true},
        {k: "correcteds", t: t("col.evaluated"), nw: true, sv: (e) => e.correcteds.map((c) => c.login).join(), f: (e) => e.correcteds.map((c) => `${avatar(c)}${esc(c.login)}`).join("<br>")},
        {k: "my_host", t: t("col.your_seat"), nw: true, hide: true, f: mySeat},
        minCol, {k: "mark", t: t("col.mark"), num: true}, flagCol,
        {k: "fb_rating", t: t("col.their_rating"), num: true, hide: true},
      ],
    };
  };
  let logRole = "received";
  function drawLog() {
    const flag = $("#logFlag").value, proj = $("#logProject").value, q = $("#logSearch").value.toLowerCase();
    const rows = D[logRole].filter((e) =>
      (!flag || (flag === "out" ? e.outstanding : flag === "bad" ? e.negative_flag : !e.outstanding && !e.negative_flag)) &&
      (!proj || e.project === proj) &&
      (!q || JSON.stringify([e.corrector.login, e.correcteds.map((c) => c.login), e.comment, e.feedback, e.feedbacks, e.my_host, e.other_host, e.project, e.begin]).toLowerCase().includes(q)));
    $("#logCount").textContent = plural(rows.length, "count.evaluations");
    makeTable($("#tblLog"), logCols()[logRole], rows, {sort: ["begin_ms", -1], empty: t("empty.search_log"), sticky: true, detail: fbText});
  }
  function renderLog() {
    const keep = $("#logProject").value;
    const projects = [...new Set([...D.received, ...D.given].map((e) => e.project))].sort();
    $("#logProject").innerHTML = `<option value="">${esc(t("log.project_all"))}</option>` + projects.map((p) => `<option${p === keep ? " selected" : ""}>${esc(p)}</option>`).join("");
    $$("select").forEach((s) => s._refresh?.());
    drawLog();
  }
  if (has("log")) {
    $("#logRole").onclick = (ev) => {
      const b = ev.target.closest("button"); if (!b) return;
      logRole = b.dataset.v;
      $$("#logRole button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      drawLog();
    };
    ["#logFlag", "#logProject"].forEach((s) => $(s).onchange = drawLog);
    $("#logSearch").oninput = drawLog;
  }

  // ---------- report charts ----------
  def("chTimeline", (th) => {
    if (!D.projects.length) return null;
    const rows = D.projects.map((p) => p.name);
    const groups = {validated: [], failed: [], open: []};
    for (const p of D.projects) for (const a of p.attempts) {
      const g = a.validated === true ? "validated" : a.validated === false ? "failed" : "open";
      groups[g].push({x: [a.start_ms, Math.max(a.end_ms, a.start_ms)], y: p.name, p, a});
    }
    const ds = (label, data, color) => ({label, data, backgroundColor: color, borderRadius: 2, borderSkipped: false, minBarLength: 4,
      grouped: false, barPercentage: 0.75, categoryPercentage: 1});
    const all = D.projects.flatMap((p) => p.attempts);
    const pad = 7 * 864e5;
    const o = opts(th, {horizontal: true});
    o.interaction = {mode: "nearest", intersect: true};
    o.scales = {
      x: {type: "linear", min: Math.min(...all.map((a) => a.start_ms)) - pad, max: Math.max(...all.map((a) => a.end_ms)) + pad,
        grid: {color: th.rule, drawTicks: false}, border: {display: false, dash: [2, 4]}, ticks: {color: th.muted, font: {size: 13}, maxRotation: 0, maxTicksLimit: 12, padding: 8, callback: (v) => fmtMonth(v)}},
      y: {type: "category", grid: {display: false}, border: {color: th.strong}, ticks: {color: th.text2, autoSkip: false, font: {size: narrow() ? 11 : 13},
        callback(v) { const l = this.getLabelForValue(v); return narrow() && l.length > 14 ? l.slice(0, 13) + "…" : l; }}},
    };
    o.plugins.tooltip.callbacks = {
      title: (items) => { const {p, a} = items[0].raw; return t("projects.tip_title", {name: p.name, n: a.n, of: p.attempts.length}); },
      label: (item) => {
        const {a} = item.raw;
        return [`${a.validated ? t("outcome.validated") : a.validated === false ? t("outcome.failed") : a.status} · ${t("projects.tip_mark", {mark: a.mark ?? "–"})}`,
          `${a.start} → ${a.closed || a.locked || t("projects.tip_open")} (${t("projects.tip_days", {n: num(a.days, 1)})})`,
          plural(a.evals.length, "count.evaluations") + (a.outstanding ? ` · ${a.outstanding} ${t("flag.outstanding")}` : ""),
          a.correctors.length ? t("projects.by", {list: a.correctors.join(", ")}) : "",
          a.members.length ? t("projects.team", {list: a.members.join(", ")}) : "",
          a.moulinette.length ? t("projects.moulinette", {marks: a.moulinette.map((m) => m.mark).join(", ")}) : ""].filter(Boolean);
      },
    };
    return {type: "bar", data: {labels: rows, datasets: [ds(t("outcome.validated"), groups.validated, th.good), ds(t("outcome.failed"), groups.failed, th.critical), ds(t("outcome.in_progress"), groups.open, th.neutral)]}, options: o};
  });
  def("chRetries", (th) => {
    const r = retryBars;
    if (!r.length) return null;
    const cfg = hbars(th, r.map((p) => p.name), [bar(t("col.retries"), r.map((p) => p.retries), th.s1, {maxBarThickness: 16})]);
    cfg.options.plugins.tooltip.callbacks = {afterLabel: (i) => t("projects.tip_marks", {marks: r[i.dataIndex].attempts.map((a) => a.mark ?? "…").join(" → ")})};
    return cfg;
  });
  def("chCumRetries", (th) => {
    const pts = D.projects.flatMap((p) => p.attempts.slice(1).map((a) => ({x: a.start_ms, label: `${p.name} · ${t("projects.attempt", {n: a.n})}`}))).sort((a, b) => a.x - b.x)
      .map((p, i) => ({...p, y: i + 1}));
    const o = opts(th, {xTime: true, range: timeRange(pts)});
    o.plugins.tooltip.callbacks.label = (i) => `${plural(i.raw.y, "count.retries")} · ${i.raw.label}`;
    return pts.length ? {type: "line", data: {datasets: [line(t("col.retries"), pts, th.s1)]}, options: o} : null;
  });
  def("chRecvMonthly", (th) => nonEmpty({type: "bar", data: {labels: D.when.months.map(monthLabel), datasets: flagStack(D.when.received_monthly, th, th.s1)}, options: opts(th, {stacked: true})}, D.when.months));
  def("chGivenMonthly", (th) => nonEmpty({type: "bar", data: {labels: D.when.months.map(monthLabel), datasets: flagStack(D.when.given_monthly, th, th.s2)}, options: opts(th, {stacked: true})}, D.when.months));
  def("chMarks", (th) => {
    const bins = [["0", (m) => m === 0], ["1–49", (m) => m > 0 && m < 50], ["50–79", (m) => m >= 50 && m < 80], ["80–99", (m) => m >= 80 && m < 100],
      ["100", (m) => m === 100], ["101–124", (m) => m > 100 && m < 125], ["125", (m) => m >= 125]];
    const count = (evs) => bins.map(([, f]) => evs.filter((e) => e.mark != null && f(e.mark)).length);
    const r = count(D.received), g = count(D.given);
    return nonEmpty({type: "bar", data: {labels: bins.map((b) => b[0]), datasets: [bar(t("role.received"), r, th.s1), bar(t("role.given"), g, th.s2)]},
      options: opts(th, {xTitle: t("received.final_mark")})}, [...r, ...g]);
  });
  def("chCumEvals", (th) => nonEmpty({type: "line", data: {datasets: [line(t("role.received"), D.when.cum_received, th.s1), line(t("role.given"), D.when.cum_given, th.s2)]},
    options: opts(th, {xTime: true, range: timeRange(D.when.cum_received, D.when.cum_given)})}, [...D.when.cum_received, ...D.when.cum_given]));
  def("chCumOut", (th) => nonEmpty({type: "line", data: {datasets: [line(t("received.out_received"), D.when.cum_out_received, th.s1), line(t("received.out_given"), D.when.cum_out_given, th.s2)]},
    options: opts(th, {xTime: true, range: timeRange(D.when.cum_out_received, D.when.cum_out_given)})}, [...D.when.cum_out_received, ...D.when.cum_out_given]));
  def("chCorrectors", (th) => {
    const top = D.people.filter((p) => p.evaluated_me).slice(0, 25);
    if (!top.length) return null;
    const cfg = hbars(th, top.map((p) => p.login), [
      bar(t("flag.other"), top.map((p) => p.evaluated_me - p.outstanding_to_me), th.s1, {...seg(th), maxBarThickness: 18}),
      bar(t("flag.outstanding"), top.map((p) => p.outstanding_to_me), th.good, {...seg(th), maxBarThickness: 18}),
    ], {stacked: true, pad: 120, fmt: (v, i) => top[i].outstanding_to_me ? `${v} · ${top[i].outstanding_to_me} ${t("flag.outstanding")}` : `${v}`});
    cfg.options.plugins.tooltip.callbacks = {afterBody: (items) => {
      const p = top[items[0].dataIndex];
      return [t("who.tip_mark", {mark: num(p.avg_mark_to_me, 1), rating: num(p.my_rating_of_them, 2)}),
        t("who.tip_cross", {you: p.evaluated_by_me, team: p.teammate}),
        ...Object.entries(p.projects_on_me).map(([k, v]) => `${k}${v > 1 ? " ×" + v : ""}`)];
    }};
    return cfg;
  });
  const edgeLabels = (edges) => edges.map((e, i) => i === edges.length - 1 ? `${e}+` : `${e}–${edges[i + 1]}`);
  def("chDuration", (th) => nonEmpty({type: "bar", data: {labels: edgeLabels(D.when.duration_edges), datasets: [
    bar(t("role.received"), D.when.duration_received, th.s1), bar(t("role.given"), D.when.duration_given, th.s2)]}, options: opts(th, {xTitle: t("when.minutes")})},
    [...D.when.duration_received, ...D.when.duration_given]));
  def("chLead", (th) => nonEmpty({type: "bar", data: {labels: edgeLabels(D.when.lead_edges), datasets: [
    bar(t("role.received"), D.when.lead_received, th.s1), bar(t("role.given"), D.when.lead_given, th.s2)]}, options: opts(th, {xTitle: t("when.hours_before")})},
    [...D.when.lead_received, ...D.when.lead_given]));
  def("chWhere", (th) => {
    const PL = D.place;
    const first = LIGHT ? PL.received_my_cluster : PL.received_corrector_cluster;
    const keys = [...new Set([...Object.keys(first), ...Object.keys(PL.given_my_cluster)])]
      .sort((a, b) => (a === "not logged") - (b === "not logged") || a.localeCompare(b));
    const label = (k) => k === "not logged" ? t("log.not_logged") : k;
    return keys.length ? {type: "bar", data: {labels: keys.map(label), datasets: [
      bar(t(LIGHT ? "where.you_evaluated" : "where.corrector_evaluating"), keys.map((k) => first[k] || 0), th.s1),
      bar(t("where.you_evaluating"), keys.map((k) => PL.given_my_cluster[k] || 0), th.s2)]}, options: opts(th)} : null;
  });
  def("chGivenProjects", (th) => {
    const c = {}; for (const e of D.given) c[e.project] = (c[e.project] || 0) + 1;
    const e = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 15);
    return e.length ? hbars(th, e.map((x) => x[0]), [bar(t("unit.evaluations"), e.map((x) => x[1]), th.s2, {maxBarThickness: 18})]) : null;
  });
  def("chByHour", (th) => {
    const h = D.stats?.by_hour;
    if (!h || !h.some((x) => x.received || x.given)) return null;
    const o = opts(th);
    o.plugins.tooltip.callbacks = {afterBody: (items) => { const x = h[items[0].dataIndex]; return t("stats.avg", {received: num(x.avg_received, 1), given: num(x.avg_given, 1)}); }};
    return {type: "bar", data: {labels: h.map((x) => String(x.hour).padStart(2, "0")), datasets: [
      bar(t("role.received"), h.map((x) => x.received), th.s1), bar(t("role.given"), h.map((x) => x.given), th.s2)]}, options: o};
  });
  def("chPoints", (th) => D.correction_points.series.length ? {type: "line", data: {datasets: [line(t("points.balance"), D.correction_points.series, th.s1)]},
    options: opts(th, {xTime: true, range: timeRange(D.correction_points.series)})} : null);
  def("chSkills", (th) => skillBars().length ? hbars(th, skillBars().map((s) => s.name),
    [bar(t("extras.level"), skillBars().map((s) => s.level), th.s1, {maxBarThickness: 18})], {fmt: (v) => num(v, 2)}) : null);
  def("chPromo", (th) => DATA.promo ? {type: "bar", data: {labels: DATA.promo.histogram.map((h) => String(h.level)),
    datasets: [bar(t("standing.students"), DATA.promo.histogram.map((h) => h.count),
      DATA.promo.histogram.map((h) => h.level === Math.floor(DATA.promo.mine) ? th.s1 : th.s2))]},
    options: opts(th, {xTitle: t("standing.level_axis")})} : null);
  def("chPace", (th) => {
    const m = ((D.insights || {}).pace || {}).months || [];
    if (!m.length) return null;
    const o = opts(th);
    o.scales.y1 = {...o.scales.y, position: "right", grid: {display: false}};
    return {type: "bar", data: {labels: m.map((x) => monthLabel(x.month)), datasets: [bar(t("pace.xp"), m.map((x) => x.xp), th.s1),
      line(t("pace.cumulative"), m.map((x) => x.cumulative), th.s2, {type: "line", yAxisID: "y1", stepped: false})]}, options: o};
  });

  // ---------- render everything for the current period ----------
  function renderAll() {
    renderRail();
    renderLegends();
    renderLogtime();
    if (has("summary")) renderSummary();
    if (has("home-kpis")) renderHomeKpis();
    if (has("projects-table")) renderTrackTable();
    if (has("correction-stats")) renderCorrectionStats();
    if (has("projects")) renderProjects();
    if (has("who")) renderWho();
    renderLedes();
    if (has("where")) renderWhere();
    if (has("feedback")) renderFeedback();
    if (has("extras")) { renderExtras(); renderSkills(); }
    if (has("standing")) renderStanding();
    if (has("pace")) renderPace();
    if (has("exams")) renderExams();
    if (has("teammates")) renderTeammates();
    if (has("depth")) renderDepth();
    renderFooter();
    $$("select").forEach((s) => s._refresh && s._refresh());  // custom listboxes follow language and option changes
    if (has("log")) renderLog();
    $("#footer").textContent = t(LIGHT ? "footer.light" : "footer.full", {when: D.generated});
    resetCharts();
    hintScroll();
    document.dispatchEvent(new CustomEvent("report:rendered", {detail: {period, data: D, all: DATA}}));
  }

  // scroll boxes fade their bottom edge while rows remain below, so a row cut by the edge reads as "more"
  function hintScroll() {
    $$(".list, .table-wrap").forEach((box) => {
      const update = () => box.classList.toggle("more", moreBelow(box));
      if (!box.dataset.hint) { box.dataset.hint = "1"; box.addEventListener("scroll", update, {passive: true}); }
      update();
    });
  }

  addEventListener("resize", hintScroll, {passive: true});
  function setPeriod(p) {
    if (p === period || !DATA.periods[p]) return;
    period = p; D = DATA.periods[p];
    store.set("period:" + PAGE, p);
    renderAll();
    document.body.classList.remove("swap"); void document.body.offsetWidth; document.body.classList.add("swap");
  }

  if (window.Chart) {
    Chart.defaults.font.family = "Barlow, system-ui, sans-serif";
    Chart.defaults.font.size = 14;
  }
  window.reportTools = {makeTable, esc, num};  // for page modules (the Connections graph)
  applyI18n();
  if (window.enhanceSelect) $$("select").forEach((s) => enhanceSelect(s));
  renderIdentity();
  renderAll();
  window.setLanguage = (dict) => { setDict(dict); applyI18n(); renderIdentity(); renderAll(); };
  return {get period() { return period; }, setPeriod, rerender: renderAll};
}
if (typeof window !== "undefined") { window.startReport = startReport; window.t = t; }
