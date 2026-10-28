// What the pages do in the browser, as v1's dash.js: tooltips beside their mark, table sorting, arrow keys in grids,
// scroll hints, the circle's focus, charts drawing in and figures counting up. Delegated listeners: the pages'
// markup is replaced on every render and the listeners stay.
import { enhanceSelect } from "../legacy/controls.js";

const $$ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => [...root.querySelectorAll<T>(s)] as T[];

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

/** beside the mark it explains, never over it: right, else left; a mark too wide for either gets it above or below */
function placeTip(el: HTMLElement, x: number | null = null) {
  const tip = tipEl();
  if (!tip || (tipFor === el && tip.style.display === "block")) return;
  tip.textContent = el.dataset.tip || "";
  tip.style.display = "block";
  tipFor = el;
  tip.style.left = tip.style.top = "0px";
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, gap = 10, edge = 8;
  let left: number, top = r.top + r.height / 2 - h / 2;
  const fitsRight = r.right + gap + w <= innerWidth - edge, fitsLeft = r.left - gap - w >= edge;
  if (el.dataset.side === "left" && fitsLeft) left = r.left - gap - w;
  else if (fitsRight) left = r.right + gap;
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

const tipOf = (t: EventTarget | null) => (t as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;

let installed = false;

export function install() {
  if (installed) return;
  installed = true;
  document.documentElement.classList.add("js");
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
    $$<HTMLDetailsElement>("details.pop[open]").forEach((d) => { if (!d.contains(ev.target as Node)) d.open = false; });
  });

  // a tooltip or an open menu never outlives what it belongs to: scrolling, leaving, resizing closes them
  let openedAt = 0;
  document.addEventListener("toggle", (ev) => {
    if ((ev.target as Element).matches?.("details.pop") && (ev.target as HTMLDetailsElement).open) openedAt = scrollY;
  }, true);
  document.addEventListener("scroll", (ev) => {
    const kb = document.activeElement?.matches?.("[data-tip]:focus-visible") ? (document.activeElement as HTMLElement) : null;
    const r = kb?.getBoundingClientRect();
    hideTip();
    if (kb && r && r.bottom > 0 && r.top < innerHeight) placeTip(kb);
    const inPop = (ev.target as Element).closest?.("details.pop");
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

/** scroll boxes fade their bottom edge while rows remain below, and a table its sides while columns wait there */
export function hintScroll(root: ParentNode = document) {
  $$(".list, .table-wrap", root).forEach((box) => {
    const update = () => {
      box.classList.toggle("more", box.scrollHeight - box.scrollTop - box.clientHeight > 2);
      box.classList.toggle("more-r", box.scrollWidth - box.scrollLeft - box.clientWidth > 2);
      box.classList.toggle("more-l", box.scrollLeft > 2);
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
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(2, -10 * k);
    el.textContent = nf.format(k < 1 ? to * e : to);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let reveal: IntersectionObserver | null = null;
let tocIO: IntersectionObserver | null = null;

/** After a render: tooltips (styled ones replace the native fallbacks), grids, scroll hints, selects, the draw-in. */
export function settle(root: ParentNode) {
  $$("[data-tip][title]", root).forEach((el) => el.removeAttribute("title"));
  $$("svg [data-tip] > title", root).forEach((el) => el.remove());
  $$(".avatar img, .avatar-lg img", root).forEach((img) => { const i = img as HTMLImageElement; if (i.complete && !i.naturalWidth) i.remove(); });
  $$("[data-roving]", root).forEach((g) => $$("[data-cell]", g).forEach((c, i) => { c.tabIndex = i ? -1 : 0; }));
  hintScroll(root);
  $$<HTMLSelectElement>("select", root).forEach((s) => enhanceSelect(s));
  $$(".cal-scroll", root).forEach((c) => { c.scrollLeft = c.scrollWidth; }); // narrow screens open on the latest months
  reveal ??= window.IntersectionObserver ? new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in");
    reveal!.unobserve(e.target);
    $$("[data-count]", e.target).forEach(countUp);
  }), { rootMargin: "0px 0px -10% 0px" }) : null;
  $$(".vchart, .hchart, .lchart, .module, .tp", root).forEach((c) => (reveal ? reveal.observe(c) : c.classList.add("in")));
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
