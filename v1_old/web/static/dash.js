"use strict";
// Dashboard enhancements; every page works without them. Tooltips, table sorting, arrow keys in grids, theme and
// accent, the section index, scroll hints and the circle's focus. Delegated listeners survive htmx swaps.

// rows of a table body (or one tbody per record) by a column's data-v, numbers numerically
function sortRows(rows, index, dir, numeric) {
  const value = (r) => r.querySelectorAll(":scope > td, :scope > tr:first-child > td")[index]?.dataset.v ?? "";
  return [...rows].sort((a, b) => {
    const va = value(a), vb = value(b);
    if (va === "") return 1;
    if (vb === "") return -1;
    return (numeric ? Number(va) - Number(vb) : va.localeCompare(vb)) * dir;
  });
}

// one tbody per record; a grouped table sorts inside each group, its header bodies (tbody.group) staying in place
function sortBodies(bodies, index, dir, numeric) {
  const out = [];
  let run = [];
  const flush = () => { out.push(...sortRows(run, index, dir, numeric)); run = []; };
  for (const b of bodies) {
    if (b.classList.contains("group")) { flush(); out.push(b); } else run.push(b);
  }
  flush();
  return out;
}

// CSV text (RFC 4180: quoted fields, doubled quotes, commas and line breaks inside quotes) as rows of fields
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

if (typeof module !== "undefined" && module.exports) module.exports = {sortRows, sortBodies, parseCsv};

if (typeof window !== "undefined" && document.body?.dataset.page) {
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  document.documentElement.classList.add("js");

  // looked up each time: a period switch swaps the body, the tooltip element with it
  const tipEl = () => document.getElementById("tip") || {style: {}};
  let tipFor = null;
  // beside the mark it explains, never over it: to its right, else its left; a mark too wide for either (a long bar,
  // a timeline row) gets it above, else below, at the pointer's x
  function placeTip(el, x = null) {
    const tip = tipEl();
    if (tipFor === el && tip.style.display === "block") return;
    tip.textContent = el.dataset.tip; tip.style.display = "block"; tipFor = el;
    tip.style.left = tip.style.top = "0px";  // measured at the corner: near the right edge it would be squeezed narrower
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, gap = 10, edge = 8;
    let left, top = r.top + r.height / 2 - h / 2;
    const fitsRight = r.right + gap + w <= innerWidth - edge, fitsLeft = r.left - gap - w >= edge;
    if (el.dataset.side === "left" && fitsLeft) left = r.left - gap - w;  // a mark that says where its tip should open
    else if (fitsRight) left = r.right + gap;
    else if (fitsLeft) left = r.left - gap - w;
    else {
      left = (x ?? r.left + r.width / 2) - w / 2;
      top = r.top - gap - h >= edge ? r.top - gap - h : r.bottom + gap;
    }
    tip.style.left = Math.max(edge, Math.min(left, innerWidth - w - edge)) + "px";
    tip.style.top = Math.max(edge, Math.min(top, innerHeight - h - edge)) + "px";
  }
  const hideTip = () => { tipEl().style.display = "none"; tipFor = null; };
  document.addEventListener("mousemove", (ev) => {
    const el = ev.target.closest?.("[data-tip]");
    if (el) placeTip(el, ev.clientX);
    else if (!document.activeElement?.dataset?.tip) hideTip();
  });
  document.addEventListener("focusin", (ev) => {
    const el = ev.target.closest?.("[data-tip]");
    if (el) placeTip(el); else hideTip();
  });
  document.addEventListener("focusout", hideTip);
  // an info mark is read, not pressed: a click never focuses it, so its tip leaves with the pointer
  document.addEventListener("mousedown", (ev) => { if (ev.target.closest?.(".info")) ev.preventDefault(); });
  // a pen or a touch has no hover: a tap shows the mark's details, a tap elsewhere hides them
  document.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse") return;
    const el = ev.target.closest?.("[data-tip]");
    if (el) placeTip(el, ev.clientX); else hideTip();
  });

  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest("th button");
    const table = btn?.closest("table");
    if (!btn) return;
    const th = btn.parentElement, index = [...th.parentElement.children].indexOf(th);
    const numeric = btn.dataset.num === "1";
    const dir = th.getAttribute("aria-sort") === "descending" ? 1 : th.getAttribute("aria-sort") === "ascending" ? -1 : numeric ? -1 : 1;
    $$("th", th.parentElement).forEach((x) => x.removeAttribute("aria-sort"));
    th.setAttribute("aria-sort", dir > 0 ? "ascending" : "descending");
    const bodies = $$(":scope > tbody", table);
    if (bodies.length > 1) table.append(...sortBodies(bodies, index, dir, numeric));
    else if (bodies[0]) bodies[0].append(...sortRows($$(":scope > tr", bodies[0]), index, dir, numeric));
  });

  // grids of cells take one Tab stop; arrow keys move inside
  function roving(root = document) {
    $$("[data-roving]", root).forEach((g) => $$("[data-cell]", g).forEach((c, i) => { c.tabIndex = i ? -1 : 0; }));
  }
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") $$("details.pop[open]").forEach((d) => { d.open = false; d.querySelector("summary").focus(); });
    const cell = ev.target.closest?.("[data-cell]"), grid = cell?.closest("[data-roving]");
    if (!grid) return;
    const cells = $$("[data-cell]", grid), i = cells.indexOf(cell);
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
  document.addEventListener("click", (ev) => {
    $$("details.pop[open]").forEach((d) => { if (!d.contains(ev.target)) d.open = false; });
  });

  // a tooltip or the open settings never outlive what they belong to: scrolling (the page or a box inside it), leaving
  // the window, resizing, Escape or swapping in new content closes them
  const closeSettings = () => $$("details.pop[open]").forEach((d) => { d.open = false; });
  let openedAt = 0, dismissed = null;
  document.addEventListener("toggle", (ev) => {
    if (ev.target.matches?.("details.pop") && ev.target.open) openedAt = scrollY;
  }, true);
  document.addEventListener("scroll", (ev) => {
    // a tooltip opened from the keyboard follows its element (Tab scrolls it into view right after focusing it)
    const kb = document.activeElement?.matches?.("[data-tip]:focus-visible") && document.activeElement !== dismissed && document.activeElement;
    const r = kb && kb.getBoundingClientRect();
    hideTip();
    if (r && r.bottom > 0 && r.top < innerHeight) placeTip(kb);
    const inSettings = ev.target.closest?.("details.pop");
    // the page's own scroll gets a few pixels of slack: opening the panel on a phone can nudge it
    if (!inSettings && (ev.target !== document || Math.abs(scrollY - openedAt) > 8)) closeSettings();
  }, {capture: true, passive: true});
  document.documentElement.addEventListener("mouseleave", hideTip);
  addEventListener("blur", hideTip);
  addEventListener("resize", () => { hideTip(); closeSettings(); }, {passive: true});
  // Escape dismisses it until focus moves on
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { hideTip(); dismissed = document.activeElement; } });
  document.addEventListener("focusin", () => { dismissed = null; });
  // only on moving around (links, boosted pages): the sync poll and the search ask in the background
  document.body.addEventListener("htmx:beforeRequest", (ev) => {
    if (ev.detail.boosted || ev.detail.elt?.tagName === "A") { hideTip(); closeSettings(); }
  });

  function applyTheme(v) {
    if (v === "light" || v === "dark") document.documentElement.dataset.theme = v;
    else delete document.documentElement.dataset.theme;
    $$("#theme button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === (v || "auto"))));
  }
  applyTheme(store.get("theme"));
  // delegated: a period switch swaps the whole body, settings included, and new buttons must still answer
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("#theme button"); if (!b) return;
    store.set("theme", b.dataset.v); applyTheme(b.dataset.v); applyAccentChoice(store.get("accent"));
  });

  const INTRA = "#00babc";
  function applyAccentChoice(v) {
    const coal = document.body.dataset.coalition;
    const choice = v === "coalition" && coal ? "coalition" : "intra", color = choice === "coalition" ? coal : INTRA;
    if (window.applyAccent) window.applyAccent(color);
    $$("#accentChoice button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === choice)));
    recolorFavicon(color);
  }
  function recolorFavicon(color) {
    if (!/^#[0-9a-f]{3,6}$/i.test(color || "")) return;
    fetch("/static/favicon.svg").then((r) => r.text()).then((svg) => {
      const url = "data:image/svg+xml," + encodeURIComponent(svg.replace(/(id="lit"[^>]*fill=")#[0-9a-f]+/i, `$1${color}`));
      $$('link[rel="icon"][type="image/svg+xml"]').forEach((l) => { l.href = url; });
    }).catch(() => {});
  }
  applyAccentChoice(store.get("accent"));
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("#accentChoice button"); if (!b || b.disabled) return;
    store.set("accent", b.dataset.v); applyAccentChoice(b.dataset.v);
  });
  // Preview: the CSV a download button would give, in a dialog; it opens once the file is here, never empty
  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest?.("[data-preview]"), dlg = document.getElementById("preview");
    if (!btn || !dlg?.showModal || btn.getAttribute("aria-busy") === "true") return;
    btn.setAttribute("aria-busy", "true");
    try {
      const r = await fetch(btn.dataset.preview, {credentials: "same-origin"});
      if (!r.ok) throw new Error(String(r.status));
      const [head = [], ...rows] = parseCsv(await r.text());
      const cell = (tag, v) => { const el = document.createElement(tag); el.textContent = v; if (tag === "th") el.scope = "col"; return el; };
      const table = document.createElement("table"), thead = table.createTHead().insertRow(), tbody = table.createTBody();
      head.forEach((h) => thead.append(cell("th", h)));
      rows.forEach((r) => { const tr = tbody.insertRow(); r.forEach((v) => tr.append(cell("td", v))); });
      table.setAttribute("aria-label", btn.dataset.title || "");
      dlg.querySelector("#preview-title").textContent = btn.dataset.title || "";
      dlg.querySelector("#preview-body").replaceChildren(table);
      hideTip(); closeSettings();
      dlg.showModal();
    } catch (e) {
      const note = document.createElement("p");
      note.className = "note"; note.setAttribute("role", "alert"); note.textContent = dlg.dataset.error || "";
      dlg.querySelector("#preview-title").textContent = btn.dataset.title || "";
      dlg.querySelector("#preview-body").replaceChildren(note);
      dlg.showModal();
    } finally {
      btn.removeAttribute("aria-busy");
    }
  });
  document.addEventListener("click", (ev) => { if (ev.target.id === "preview") ev.target.close(); });  // the backdrop

  // moving to another page: a thin bar runs under the band until the new page (or swap) arrives; nothing changes before
  const leaving = (on) => document.documentElement.classList.toggle("leaving", on);
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest?.("a[href]");
    if (!a || ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || a.target || a.hasAttribute("download")) return;
    const u = new URL(a.href, location.href);
    if (u.origin === location.origin && (u.pathname !== location.pathname || u.search !== location.search)) leaving(true);
  });
  document.addEventListener("submit", () => leaving(true));
  addEventListener("pageshow", () => leaving(false));  // back from the next page (bfcache) with the bar still on
  ["htmx:afterSettle", "htmx:responseError", "htmx:sendError"].forEach((n) => document.body.addEventListener(n, () => leaving(false)));

  // the swapped-in settings show the current choices again
  document.body.addEventListener("htmx:afterSettle", () => { applyTheme(store.get("theme")); applyAccentChoice(store.get("accent")); });

  // the first visit points at the star once; "Got it" or opening the star puts it away for good
  function tour() {
    const note = document.querySelector(".tour");
    if (!note) return;
    const shade = document.querySelector(".tour-shade");
    if (store.get("tour:star")) { note.hidden = true; if (shade) shade.hidden = true; return; }
    note.hidden = false; if (shade) shade.hidden = false;
    const done = () => { note.hidden = true; if (shade) shade.hidden = true; store.set("tour:star", "1"); };
    note.querySelector("[data-tour-ok]")?.addEventListener("click", done);
    shade?.addEventListener("click", done);
    note.closest(".best-anchor")?.querySelector(".best-wrap")?.addEventListener("toggle", (ev) => { if (ev.target.open) done(); });
  }
  tour();
  document.body.addEventListener("htmx:afterSettle", tour);
  document.addEventListener("click", (ev) => {  // make dev only: the settings bring the first-visit note back
    if (!ev.target.closest?.("[data-tour-again]")) return;
    store.set("tour:star", ""); closeSettings(); tour();
  });

  // the period switch shows in the settings too while the page's own is not wholly in sight: scrolled away, under the
  // band, or under the open panel itself (measured with the copy shown, the panel's tallest)
  function periodCopy() {
    const copy = document.querySelector(".periods-wrap"), own = document.querySelector(".page-head .periods");
    const panel = copy?.closest(".settings");
    if (!copy || !own || !panel?.offsetParent) return;
    copy.hidden = false;
    const r = own.getBoundingClientRect(), p = panel.getBoundingClientRect();
    const band = Math.max(0, document.querySelector(".topbar")?.getBoundingClientRect().bottom || 0);
    const covered = p.left < r.right && p.right > r.left && p.top < r.bottom && p.bottom > r.top;
    copy.hidden = r.top >= band && r.bottom <= innerHeight && !covered;
  }
  document.addEventListener("toggle", (ev) => { if (ev.target.matches?.(".settings-wrap") && ev.target.open) periodCopy(); }, true);
  addEventListener("scroll", periodCopy, {passive: true});

  // the section in view lights up in the section index
  let tocIO;
  function watchToc() {
    tocIO?.disconnect();
    const links = Object.fromEntries($$(".toc a").map((a) => [a.hash.slice(1), a]));
    tocIO = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      Object.values(links).forEach((a) => a.removeAttribute("aria-current"));
      links[e.target.id]?.setAttribute("aria-current", "true");
    }), {rootMargin: "-30% 0px -65% 0px"});
    $$("main > section[id]").forEach((s) => tocIO.observe(s));
  }

  // scroll boxes fade their bottom edge while rows remain below, and a table its sides while columns wait there
  function hintScroll(root = document) {
    $$(".list, .table-wrap", root).forEach((box) => {
      const update = () => {
        box.classList.toggle("more", box.scrollHeight - box.scrollTop - box.clientHeight > 2);
        box.classList.toggle("more-r", box.scrollWidth - box.scrollLeft - box.clientWidth > 2);
        box.classList.toggle("more-l", box.scrollLeft > 2);
      };
      if (!box.dataset.hint) { box.dataset.hint = "1"; box.addEventListener("scroll", update, {passive: true}); }
      update();
    });
  }

  // the circle: hovering or focusing someone keeps only their chords in view
  function focusNet(ev, on) {
    const node = ev.target.closest?.(".net-node[data-login]");
    if (!node) return;
    const svg = node.closest("svg"), login = on ? node.dataset.login : null;
    svg.classList.toggle("focused", !!login);
    svg.classList.toggle("focus-me", !!login && login === svg.dataset.me);
    $$("path[data-a]", svg).forEach((p) => p.classList.toggle("hl", !!login && (p.dataset.a === login || p.dataset.b === login)));
    // you dim while the one in focus has no chord with you
    const me = svg.dataset.me;
    svg.classList.toggle("me-off", !!login && login !== me && !$$("path.hl", svg).some((p) => p.dataset.a === me || p.dataset.b === me));
  }
  document.addEventListener("mouseover", (ev) => focusNet(ev, true));
  document.addEventListener("mouseout", (ev) => focusNet(ev, false));
  document.addEventListener("focusin", (ev) => focusNet(ev, true));
  document.addEventListener("focusout", (ev) => focusNet(ev, false));

  // a photo that fails to load leaves the initials underneath (also those that failed before this script ran)
  const PHOTO = ".avatar img, .avatar-lg img";
  document.addEventListener("error", (ev) => { if (ev.target.matches?.(PHOTO)) ev.target.remove(); }, true);

  // without this script every mark shows the browser's own tooltip (title / <title>); with it, the styled one only
  function ownTooltips(root = document) {
    $$("[data-tip][title]", root).forEach((el) => el.removeAttribute("title"));
    $$("svg [data-tip] > title", root).forEach((el) => el.remove());
  }

  // charts draw in, and module figures count up, the first time they scroll into view
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = (v, d) => new Intl.NumberFormat(document.documentElement.lang === "es" ? "es-ES" : "en-GB",
    {minimumFractionDigits: d, maximumFractionDigits: d}).format(v);
  function countUp(el) {
    const to = Number(el.dataset.count), d = Number(el.dataset.dec || 0), t0 = performance.now(), ms = 900;
    if (still || !isFinite(to)) return;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(2, -10 * k);  // exponential ease-out
      el.textContent = fmt(k < 1 ? to * e : to, d);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const reveal = window.IntersectionObserver && new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in"); reveal.unobserve(e.target);
    $$("[data-count]", e.target).forEach(countUp);
  }), {rootMargin: "0px 0px -10% 0px"});
  function drawIn(root = document) {
    $$(".vchart, .hchart, .lchart, .module", root).forEach((c) => reveal ? reveal.observe(c) : c.classList.add("in"));
  }

  function settle(root = document) {
    drawIn(root);
    ownTooltips(root);
    $$(PHOTO, root).forEach((img) => { if (img.complete && !img.naturalWidth) img.remove(); });
    roving(root);
    hintScroll(root);
    if (window.enhanceSelect) $$("select", root).forEach((s) => enhanceSelect(s));
    $$(".cal-scroll", root).forEach((c) => { c.scrollLeft = c.scrollWidth; });  // narrow screens open on the latest months
  }
  // the report's original lives in this browser (IndexedDB); the server keeps a signed copy for an hour
  const csrf = (() => { try { return JSON.parse(document.body.getAttribute("hx-headers"))["X-CSRF-Token"]; } catch (e) { return ""; } })();
  const login = document.body.dataset.login;
  function db() {
    return new Promise((ok, ko) => {
      const r = indexedDB.open("logbook", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("reports");
      r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
    });
  }
  async function idb(mode, op) {
    const d = await db();
    return new Promise((ok, ko) => {
      const req = op(d.transaction("reports", mode).objectStore("reports"));
      req.onsuccess = () => ok(req.result); req.onerror = () => ko(req.error);
    });
  }
  const forget = () => idb("readwrite", (s) => s.delete(login)).catch(() => {});

  async function keepCopy() {
    const sig = document.body.dataset.report;
    if (!sig || !login) return;
    const mine = await idb("readonly", (s) => s.get(login)).catch(() => null);
    if (mine?.sig === sig) return;
    const r = await fetch("/app/report.json", {credentials: "same-origin"});
    if (!r.ok) return;
    const copy = {sig: r.headers.get("X-Report-Sig"), body: await r.arrayBuffer()};
    await idb("readwrite", (s) => s.put(copy, login)).catch(() => {});
  }
  async function restore(panel) {
    const mine = await idb("readonly", (s) => s.get(login)).catch(() => null);
    if (mine) {
      const r = await fetch("/app/report", {method: "POST", credentials: "same-origin", body: mine.body,
        headers: {"X-CSRF-Token": csrf, "X-Report-Sig": mine.sig, "Content-Type": "application/json"}});
      if (r.ok) { location.reload(); return; }
      await forget();
    }
    location.replace(panel.dataset.fresh);
  }
  // signing out or deleting also removes this browser's copy
  document.addEventListener("submit", (ev) => {
    const form = ev.target;
    if (!/\/(auth\/logout|app\/delete)$/.test(form.action) || form.dataset.cleared) return;
    ev.preventDefault();
    forget().finally(() => { form.dataset.cleared = "1"; form.submit(); });
  });

  const restoring = document.querySelector("[data-restore]");
  if (restoring && window.indexedDB) restore(restoring);
  else if (restoring) location.replace(restoring.dataset.fresh);
  else if (window.indexedDB) keepCopy();

  settle();
  watchToc();
  addEventListener("resize", () => hintScroll(), {passive: true});
  document.body.addEventListener("htmx:afterSettle", (ev) => { settle(ev.detail.elt); watchToc(); });
}
