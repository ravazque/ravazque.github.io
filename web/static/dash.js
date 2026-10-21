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

if (typeof module !== "undefined" && module.exports) module.exports = {sortRows};

if (typeof window !== "undefined" && document.body?.dataset.page) {
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  document.documentElement.classList.add("js");

  const tip = document.getElementById("tip");
  function showTip(text, x, y) {
    tip.textContent = text; tip.style.display = "block";
    tip.style.left = Math.max(8, Math.min(x, innerWidth - tip.offsetWidth - 8)) + "px";
    tip.style.top = (y + tip.offsetHeight + 8 > innerHeight ? y - tip.offsetHeight - 28 : y) + "px";
  }
  document.addEventListener("mousemove", (ev) => {
    const el = ev.target.closest?.("[data-tip]");
    if (el) showTip(el.dataset.tip, ev.clientX + 12, ev.clientY + 16);
    else if (!document.activeElement?.dataset?.tip) tip.style.display = "none";
  });
  document.addEventListener("focusin", (ev) => {
    const el = ev.target.closest?.("[data-tip]");
    if (!el) { tip.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    showTip(el.dataset.tip, r.left, r.bottom + 8);
  });
  document.addEventListener("focusout", () => { tip.style.display = "none"; });

  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest("th button");
    const table = btn?.closest("table");
    if (!btn || table.hasAttribute("data-nosort")) return;
    const th = btn.parentElement, index = [...th.parentElement.children].indexOf(th);
    const numeric = btn.dataset.num === "1";
    const dir = th.getAttribute("aria-sort") === "descending" ? 1 : th.getAttribute("aria-sort") === "ascending" ? -1 : numeric ? -1 : 1;
    $$("th", th.parentElement).forEach((x) => x.removeAttribute("aria-sort"));
    th.setAttribute("aria-sort", dir > 0 ? "ascending" : "descending");
    const bodies = $$(":scope > tbody", table);
    if (bodies.length > 1) table.append(...sortRows(bodies, index, dir, numeric));
    else if (bodies[0]) bodies[0].append(...sortRows($$(":scope > tr", bodies[0]), index, dir, numeric));
  });

  // grids of cells take one Tab stop; arrow keys move inside
  function roving(root = document) {
    $$("[data-roving]", root).forEach((g) => $$("[data-cell]", g).forEach((c, i) => { c.tabIndex = i ? -1 : 0; }));
  }
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") $$("details.settings-wrap[open]").forEach((d) => { d.open = false; d.querySelector("summary").focus(); });
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
    $$("details.settings-wrap[open]").forEach((d) => { if (!d.contains(ev.target)) d.open = false; });
  });

  function applyTheme(v) {
    if (v === "light" || v === "dark") document.documentElement.dataset.theme = v;
    else delete document.documentElement.dataset.theme;
    $$("#theme button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === (v || "auto"))));
  }
  applyTheme(store.get("theme"));
  document.getElementById("theme")?.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
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
  document.getElementById("accentChoice")?.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b || b.disabled) return;
    store.set("accent", b.dataset.v); applyAccentChoice(b.dataset.v);
  });

  // the section in view lights up in the rail's index
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

  // scroll boxes fade their bottom edge while rows remain below
  function hintScroll(root = document) {
    $$(".list, .table-wrap", root).forEach((box) => {
      const update = () => box.classList.toggle("more", box.scrollHeight - box.scrollTop - box.clientHeight > 2);
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
    $$("path[data-a]", svg).forEach((p) => p.classList.toggle("hl", !!login && (p.dataset.a === login || p.dataset.b === login)));
  }
  document.addEventListener("mouseover", (ev) => focusNet(ev, true));
  document.addEventListener("mouseout", (ev) => focusNet(ev, false));
  document.addEventListener("focusin", (ev) => focusNet(ev, true));
  document.addEventListener("focusout", (ev) => focusNet(ev, false));

  // a photo that fails to load leaves the initials underneath (also those that failed before this script ran)
  const PHOTO = ".avatar img, .avatar-lg img";
  document.addEventListener("error", (ev) => { if (ev.target.matches?.(PHOTO)) ev.target.remove(); }, true);

  function settle(root = document) {
    $$(PHOTO, root).forEach((img) => { if (img.complete && !img.naturalWidth) img.remove(); });
    roving(root);
    hintScroll(root);
    if (window.enhanceSelect) $$("select", root).forEach((s) => enhanceSelect(s));
    $$(".cal-scroll", root).forEach((c) => { c.scrollLeft = c.scrollWidth; });  // narrow screens open on the latest months
  }
  settle();
  watchToc();
  addEventListener("resize", () => hintScroll(), {passive: true});
  document.body.addEventListener("htmx:afterSettle", (ev) => { settle(ev.detail.elt); watchToc(); });
}
