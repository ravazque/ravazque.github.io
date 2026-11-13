// What the pages do in the browser, as v1's dash.js: tooltips beside their mark, table sorting, arrow keys in grids,
// scroll hints, the circle's focus, charts drawing in and figures counting up. Delegated listeners: the pages'
// markup is replaced on every render and the listeners stay.
import { enhanceSelect } from "../legacy/controls.js";

const $$ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => [...root.querySelectorAll<T>(s)] as T[];

/** How far the page moves in a frame while dragging: near the band or the window's bottom, faster the closer to the edge. */
export function dragScroll(y: number, top: number, height: number, zone = 110, most = 24): number {
  if (y < 0) return 0;
  const up = top + zone - y, down = y - (height - zone);
  return up > 0 ? -Math.ceil(most * Math.min(1, up / zone)) : down > 0 ? Math.ceil(most * Math.min(1, down / zone)) : 0;
}

/** rows of a table body (or one tbody per record) by a column's data-v, numbers numerically */
export function sortRows<T extends Element>(rows: T[], index: number, dir: number, numeric: boolean): T[] {
  const value = (r: Element) => (r.querySelectorAll(":scope > td, :scope > tr:first-child > td")[index] as HTMLElement | undefined)?.dataset.v ?? "";
  return [...rows].sort((a, b) => {
    const va = value(a), vb = value(b);
    if (va === "") return 1;
    if (vb === "") return -1;
    return (numeric ? Number(va) - Number(vb) : va.localeCompare(vb)) * dir;
  });
}

/** one tbody per record; a grouped table sorts inside each group, its header bodies staying in place */
export function sortBodies<T extends Element>(bodies: T[], index: number, dir: number, numeric: boolean): T[] {
  const out: T[] = [];
  let run: T[] = [];
  const flush = () => { out.push(...sortRows(run, index, dir, numeric)); run = []; };
  for (const b of bodies) if (b.classList.contains("group")) { flush(); out.push(b); } else run.push(b);
  flush();
  return out;
}

let tipFor: Element | null = null;
const tipEl = () => document.getElementById("tip") as HTMLElement | null;

/** The way out from a ring's centre at an angle (degrees, 0 = right, 90 = down), in eighths: -1, 0 or 1 across and down. */
export function outward(deg: number): [number, number] {
  const a = (deg * Math.PI) / 180, x = Math.cos(a), y = Math.sin(a), q = (v: number) => (Math.abs(v) < 0.38 ? 0 : Math.sign(v));
  return [q(x), q(y)];
}

/** beside the mark it explains, never over it: right, else left; a mark too wide for either gets it above or below. A node
 * of a ring (data-angle) gets it right next to it, outwards from the ring's centre, turned the other way on a side the
 * window has no room on */
function placeTip(el: HTMLElement, x: number | null = null) {
  const tip = tipEl();
  if (!tip || (tipFor === el && tip.style.display === "block")) return;
  const text = el.dataset.tip || "";
  // one fact per line, the first one as its heading: tips with their own breaks keep them, others split at " · "; a
  // line "---" is a rule (between what a tip says and the list under it)
  const lines = (text.includes("\n") ? text.split("\n") : text.split(" · ")).map((l) => l.trim()).filter(Boolean);
  tip.replaceChildren(...lines.map((l, i) => (l === "---" ? document.createElement("hr") : Object.assign(document.createElement(i ? "span" : "b"), { textContent: l }))));
  tip.style.display = "block";
  tipFor = el;
  tip.style.left = tip.style.top = "0px";
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, gap = 10, edge = 8;
  let left: number, top = r.top + r.height / 2 - h / 2;
  const fitsRight = r.right + gap + w <= innerWidth - edge, fitsLeft = r.left - gap - w >= edge;
  const fitsAbove = r.top - gap - h >= edge, fitsBelow = r.bottom + gap + h <= innerHeight - edge;
  if (el.dataset.angle) {
    let [hx, vy] = outward(+el.dataset.angle);
    if (hx > 0 && !fitsRight) hx = -1; else if (hx < 0 && !fitsLeft) hx = 1;
    if (vy > 0 && !fitsBelow) vy = -1; else if (vy < 0 && !fitsAbove) vy = 1;
    left = hx > 0 ? r.right + gap : hx < 0 ? r.left - gap - w : r.left + r.width / 2 - w / 2;
    top = vy > 0 ? r.bottom + gap : vy < 0 ? r.top - gap - h : r.top + r.height / 2 - h / 2;
  } else if (fitsRight) left = r.right + gap;
  else if (fitsLeft) left = r.left - gap - w;
  else {
    left = (x ?? r.left + r.width / 2) - w / 2;
    top = r.top - gap - h >= edge ? r.top - gap - h : r.bottom + gap;
  }
  tip.style.left = Math.max(edge, Math.min(left, innerWidth - w - edge)) + "px";
  tip.style.top = Math.max(edge, Math.min(top, innerHeight - h - edge)) + "px";
}

export function hideTip() {
  const tip = tipEl();
  if (tip) tip.style.display = "none";
  tipFor = null;
}

export const closePops = () => $$<HTMLDetailsElement>("details.pop[open]").forEach((d) => { d.open = false; });

/** Where a floating panel opens: under its opener (left-aligned), above it when there is no room below, kept on screen. */
export function floatAt(r: DOMRect, w: number, h: number, vw = innerWidth, vh = innerHeight) {
  const gap = 6, edge = 8, below = r.bottom + gap, above = r.top - gap - h;
  const top = below + h <= vh - edge ? below : above >= edge ? above : Math.max(edge, Math.min(below, vh - h - edge));
  return { left: Math.max(edge, Math.min(r.left, vw - w - edge)), top };
}

// a details.pop[data-float] shows its panel in one floating element on the page: inside a table the scroll box would
// clip and fade it; the panel inside stays for screen readers, the floating copy is for the eyes
let floatFor: HTMLDetailsElement | null = null;
const floatEl = () => document.getElementById("float") as HTMLElement | null;
function openFloat(d: HTMLDetailsElement) {
  let el = floatEl();
  if (!el) {
    el = Object.assign(document.createElement("div"), { id: "float", className: "float-panel" });
    el.setAttribute("aria-hidden", "true");
    document.body.append(el);
  }
  el.innerHTML = d.querySelector(":scope > .pop-panel")?.innerHTML || "";
  el.hidden = false;
  el.style.left = el.style.top = "0px";
  const { left, top } = floatAt(d.querySelector("summary")!.getBoundingClientRect(), el.offsetWidth, el.offsetHeight);
  Object.assign(el.style, { left: `${left}px`, top: `${top}px` });
  floatFor = d;
}
export function closeFloat() {
  const el = floatEl();
  if (el) el.hidden = true;
  floatFor = null;
}

const tipOf = (t: EventTarget | null) => (t as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;

let installed = false;

export function install() {
  if (installed) return;
  installed = true;
  document.documentElement.classList.add("js");
  addEventListener("pagehide", () => pageSeen(visit)); // leaving the tab or reloading counts as leaving the page
  document.addEventListener("mousemove", (ev) => {
    const el = tipOf(ev.target);
    if (el) placeTip(el, ev.clientX);
    else if (!(document.activeElement as HTMLElement | null)?.dataset?.tip) hideTip();
  });
  document.addEventListener("focusin", (ev) => { const el = tipOf(ev.target); if (el) placeTip(el); else hideTip(); });
  document.addEventListener("focusout", hideTip);
  // an info mark is read, not pressed: a click never focuses it
  document.addEventListener("mousedown", (ev) => { if ((ev.target as Element).closest?.(".info")) ev.preventDefault(); });
  // a pen or a touch has no hover: a tap shows the mark's details, a tap elsewhere hides them
  document.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse") return;
    const el = tipOf(ev.target);
    if (el) placeTip(el, ev.clientX); else hideTip();
  });

  document.addEventListener("click", (ev) => {
    const btn = (ev.target as Element).closest?.("th button") as HTMLButtonElement | null;
    const table = btn?.closest("table");
    if (!btn || !table) return;
    const th = btn.parentElement!, index = [...th.parentElement!.children].indexOf(th);
    const numeric = btn.dataset.num === "1";
    const dir = th.getAttribute("aria-sort") === "descending" ? 1 : th.getAttribute("aria-sort") === "ascending" ? -1 : numeric ? -1 : 1;
    $$("th", th.parentElement!).forEach((x) => x.removeAttribute("aria-sort"));
    th.setAttribute("aria-sort", dir > 0 ? "ascending" : "descending");
    const bodies = $$(":scope > tbody", table);
    if (bodies.length > 1) table.append(...sortBodies(bodies, index, dir, numeric));
    else if (bodies[0]) bodies[0].append(...sortRows($$(":scope > tr", bodies[0]), index, dir, numeric));
  });

  // grids of cells take one Tab stop; arrow keys move inside
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      hideTip();
      $$<HTMLDetailsElement>("details.pop[open]").forEach((d) => { d.open = false; d.querySelector("summary")?.focus(); });
    }
    const cell = (ev.target as Element).closest?.("[data-cell]") as HTMLElement | null, grid = cell?.closest("[data-roving]");
    if (!cell || !grid) return;
    const cells = $$("[data-cell]", grid), i = cells.indexOf(cell);
    let next: HTMLElement | undefined;
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
    const inFloat = floatEl()?.contains(ev.target as Node);
    $$<HTMLDetailsElement>("details.pop[open]").forEach((d) => { if (!d.contains(ev.target as Node) && !(inFloat && d === floatFor)) d.open = false; });
  });

  // a tooltip or an open menu never outlives what it belongs to: scrolling, leaving, resizing closes them
  let openedAt = 0;
  document.addEventListener("toggle", (ev) => {
    const d = ev.target as HTMLDetailsElement;
    if (d.matches?.("details.pop") && d.open) openedAt = scrollY;
    if (d.matches?.("details.pop[data-float]")) { if (d.open) openFloat(d); else if (d === floatFor) closeFloat(); }
  }, true);
  document.addEventListener("scroll", (ev) => {
    const kb = document.activeElement?.matches?.("[data-tip]:focus-visible") ? (document.activeElement as HTMLElement) : null;
    const r = kb?.getBoundingClientRect();
    hideTip();
    if (kb && r && r.bottom > 0 && r.top < innerHeight) placeTip(kb);
    const inPop = (ev.target as Element).closest?.("details.pop, #float");
    if (!inPop && (ev.target !== document || Math.abs(scrollY - openedAt) > 8)) closePops();
  }, { capture: true, passive: true });
  document.documentElement.addEventListener("mouseleave", hideTip);
  addEventListener("blur", hideTip);
  addEventListener("resize", () => { hideTip(); closePops(); hintScroll(); }, { passive: true });

  // the circle: hovering or focusing someone keeps only their chords in view
  const focusNet = (ev: Event, on: boolean) => {
    const node = (ev.target as Element).closest?.(".net-node[data-login]") as SVGGElement | null;
    if (!node) return;
    const svg = node.closest("svg")!, login = on ? node.dataset.login : null, me = svg.dataset.me;
    svg.classList.toggle("focused", !!login);
    svg.classList.toggle("focus-me", !!login && login === me);
    $$<SVGPathElement>("path[data-a]", svg).forEach((p) => p.classList.toggle("hl", !!login && (p.dataset.a === login || p.dataset.b === login)));
    svg.classList.toggle("me-off", !!login && login !== me && !$$<SVGPathElement>("path.hl", svg).some((p) => p.dataset.a === me || p.dataset.b === me));
  };
  document.addEventListener("mouseover", (ev) => focusNet(ev, true));
  document.addEventListener("mouseout", (ev) => focusNet(ev, false));
  document.addEventListener("focusin", (ev) => focusNet(ev, true));
  document.addEventListener("focusout", (ev) => focusNet(ev, false));
  // a photo that fails to load leaves the initials underneath
  document.addEventListener("error", (ev) => { if ((ev.target as Element).matches?.(".avatar img, .avatar-lg img, .me-photo img")) (ev.target as Element).remove(); }, true);
}

/** scroll boxes fade each edge where more waits (more-t, more for the bottom, more-l, more-r), and give the CSS their
 * scrollbars' thickness, a table's sticky head height and its sticky first column's width so none of them is faded */
export function hintScroll(root: ParentNode = document) {
  $$(".list, .table-wrap, .cal-scroll, .radar-bars", root).forEach((box) => {
    const update = () => {
      box.classList.toggle("more-t", box.scrollTop > 2);
      box.classList.toggle("more", box.scrollHeight - box.scrollTop - box.clientHeight > 2);
      box.classList.toggle("more-r", box.scrollWidth - box.scrollLeft - box.clientWidth > 2);
      box.classList.toggle("more-l", box.scrollLeft > 2);
      const cs = getComputedStyle(box), px = (v: string) => parseFloat(v) || 0;
      box.style.setProperty("--sb-w", `${Math.max(0, box.offsetWidth - box.clientWidth - px(cs.borderLeftWidth) - px(cs.borderRightWidth))}px`);
      box.style.setProperty("--sb-h", `${Math.max(0, box.offsetHeight - box.clientHeight - px(cs.borderTopWidth) - px(cs.borderBottomWidth))}px`);
      box.style.setProperty("--head-h", `${box.querySelector<HTMLElement>(":scope > table > thead")?.offsetHeight || 0}px`);
      box.style.setProperty("--stick-w", `${box.querySelector<HTMLElement>(":scope > table.sticky-first th:first-child")?.offsetWidth || 0}px`);
      box.style.setProperty("--wrap-w", `${box.clientWidth}px`); // what shows of a wide table: an opened comment keeps to it
    };
    if (!box.dataset.hint) { box.dataset.hint = "1"; box.addEventListener("scroll", update, { passive: true }); }
    update();
  });
}

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function countUp(el: HTMLElement) {
  const to = Number(el.dataset.count), d = Number(el.dataset.dec || 0), t0 = performance.now(), ms = 900;
  if (still() || !Number.isFinite(to)) return;
  const nf = new Intl.NumberFormat(document.documentElement.lang === "es" ? "es-ES" : "en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const hm = el.dataset.hm ? new Intl.NumberFormat(document.documentElement.lang === "es" ? "es-ES" : "en-GB", { maximumFractionDigits: 0 }) : null;
  const show = (v: number) => { const m = Math.round(v * 60); return hm ? `${hm.format(Math.floor(m / 60))}:${String(m % 60).padStart(2, "0")}` : nf.format(v); };
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(2, -10 * k);
    el.textContent = show(k < 1 ? to * e : to);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A big figure with no data-count counts up from its own text: its first number, in the format it has ("1,131:21",
 * "4.64", "#104", "59:06 h"); the last frame puts the original text back. */
function countText(el: HTMLElement) {
  if (still()) return;
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Text | null = null, m: RegExpExecArray | null = null;
  while (walk.nextNode() && !m) { node = walk.currentNode as Text; m = /\d[\d.,]*(?::\d\d)?/.exec(node.data); }
  if (!node || !m) return;
  const lang = document.documentElement.lang === "es" ? "es-ES" : "en-GB", dec = lang === "es-ES" ? "," : ".", group = dec === "," ? "." : ",";
  const tok = m[0], [whole, mins] = tok.split(":"), digits = whole.includes(dec) ? whole.split(dec)[1].length : 0;
  const n = parseFloat(whole.split(group).join("").replace(dec, ".")), to = mins ? n * 60 + +mins : n;
  if (!Number.isFinite(to) || !to) return;
  const nf = new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }), whole0 = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 });
  const before = node.data.slice(0, m.index), after = node.data.slice(m.index + tok.length), text = node, t0 = performance.now();
  const show = (v: number) => (mins ? `${whole0.format(Math.floor(v / 60))}:${String(Math.floor(v % 60)).padStart(2, "0")}` : nf.format(v));
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(2, -10 * k);
    text.data = before + (k < 1 ? show(to * e) : tok) + after;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let reveal: IntersectionObserver | null = null;
let tocIO: IntersectionObserver | null = null;

/* Draw-in (owner, 2026-11-09; in this browser and on a reload since 2026-11-12): the first time you open a page in this
   browser, each chart and figure draws in when it comes into view; once you leave the page (or the tab), the page counts
   as seen and shows at once from then on, seen or not, in every tab. Reloading a page draws it in again. On the visit itself, a part already drawn in shows at once when the page is drawn again (a filter, a
   refresh). Only a part marked data-anim is hidden by the CSS, so a page drawn again never flashes or replays. */
const seenPages = (): string[] => { try { return JSON.parse(localStorage.getItem("drawn") || "[]"); } catch { return []; } };
const savePages = (pages: string[]) => { try { localStorage.setItem("drawn", JSON.stringify(pages)); } catch { /* private mode */ } };
function pageSeen(page: string) {
  if (page && !seenPages().includes(page)) savePages([...seenPages(), page]);
}
let reloaded = (performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "reload";
let visit = "", drawnIn = new Set<string>(); // the page on screen, and the parts of it drawn in on this visit

/** "Delete my data" clears the browser's storage: leaving must not write the page on screen back as seen. */
export function forgetVisit() { visit = ""; }

/** Every page draws in again, as on the session's first visit (the owner's dev-live button): forget them and reload,
 * without the reload marking the page on screen as seen. */
export function replayDrawIn() {
  visit = "";
  try { localStorage.removeItem("drawn"); } catch { /* private mode */ }
  location.reload();
}

/** After a render: tooltips (styled ones replace the native fallbacks), grids, scroll hints, selects, the draw-in. */
export function settle(root: ParentNode) {
  closeFloat(); // what opened it was just drawn again
  $$("[data-tip][title]", root).forEach((el) => el.removeAttribute("title"));
  $$("svg [data-tip] > title", root).forEach((el) => el.remove());
  $$(".avatar img, .avatar-lg img", root).forEach((img) => { const i = img as HTMLImageElement; if (i.complete && !i.naturalWidth) i.remove(); });
  $$("[data-roving]", root).forEach((g) => $$("[data-cell]", g).forEach((c, i) => { c.tabIndex = i ? -1 : 0; }));
  hintScroll(root);
  $$<HTMLSelectElement>("select", root).forEach((s) => enhanceSelect(s));
  // an image that cannot load (offline, the CDN down) leaves its place: a banner to its colour, a logo to a square
  $$<HTMLImageElement>("img[data-fallback]", root).forEach((img) => {
    const drop = () => (img.classList.contains("logo") ? img.replaceWith(Object.assign(document.createElement("i"), { className: "logo" })) : img.remove());
    if (img.complete && !img.naturalWidth) drop(); else img.addEventListener("error", drop, { once: true });
  });
  $$(".cal-scroll", root).forEach((c) => { c.scrollLeft = c.scrollWidth; }); // narrow screens open on the latest months
  reveal ??= window.IntersectionObserver ? new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target as HTMLElement;
    el.classList.add("in");
    drawnIn.add(el.dataset.anim || "");
    reveal!.unobserve(el);
    $$("[data-count]", el).forEach(countUp);
    $$<HTMLElement>(".v, .figure", el).filter((x) => !x.querySelector("[data-count]")).forEach(countText); // big figures of every page
  }), { rootMargin: "0px 0px -10% 0px" }) : null;
  const page = (root as HTMLElement).closest?.("[data-page]")?.getAttribute("data-page") || "";
  if (page !== visit) { pageSeen(visit); visit = page; drawnIn = new Set(); } // leaving a page: it counts as seen
  if (page && reloaded) { reloaded = false; savePages(seenPages().filter((p) => p !== page)); } // a reload draws its page in again
  const first = !!page && !seenPages().includes(page);
  const index = new Map<Element | null, number>();
  $$<HTMLElement>(".vchart, .hchart, .lchart, .module, .tp, .kpis > div, .rates > div, .pf-time", root).forEach((c) => {
    if (c.closest(".skel")) return; // a skeleton is no drawing
    const sec = c.closest("section[id]"), n = index.get(sec) ?? 0, key = `${sec?.id || ""}:${n}`;
    index.set(sec, n + 1);
    if (first && reveal && !drawnIn.has(key)) { c.dataset.anim = key; reveal.observe(c); return; }
    delete c.dataset.anim;
    c.classList.add("in");
  });
  // the section in view lights up in the section index
  tocIO?.disconnect();
  const links = Object.fromEntries($$<HTMLAnchorElement>(".toc a").map((a) => [a.hash.slice(1), a]));
  tocIO = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    Object.values(links).forEach((a) => a.removeAttribute("aria-current"));
    links[(e.target as HTMLElement).id]?.setAttribute("aria-current", "true");
  }), { rootMargin: "-30% 0px -65% 0px" });
  $$("main section[id]").forEach((s) => tocIO!.observe(s));
}
