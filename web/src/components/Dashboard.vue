<script setup lang="ts">
// The six app pages. Asks for the status first (consent, a report, an extraction running), then the period's view,
// builds the sections as markup and lets the browser behaviours take it from there.
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { HttpError, api, fmt, hasPin, loadPins, loadSession, moveWidget, pins, relabelStars, setActivity, setWidget, state, togglePin, untilQuarter, type ActivityState, type Status } from "../state";
import { closePops, dragScroll, hideTip, settle } from "../lib/behave";
import { idbShelf, keepCopy, restore, stale } from "../lib/copy";
import { esc, initials } from "../lib/h";
import { parseCsv } from "../lib/table";
import { Page, pagePeriod, type PageKey, type Section, type View } from "../views/page";
import { profile as profileSections } from "../views/profile";
import { portfolioCsv, projects, projectsCsv } from "../views/projects";
import { evaluations } from "../views/evaluations";
import { people } from "../views/people";
import { campus } from "../views/campus";
import { coalition } from "../views/coalition";
import AppHeader from "./AppHeader.vue";
import SiteCredit from "./SiteCredit.vue";

const route = useRoute(), router = useRouter();
const f = computed(() => fmt.value);
const key = computed<PageKey>(() => ((route.params.page as string) || "home") as PageKey);
const view = shallowRef<View | null>(null);
const screen = ref<"loading" | "consent" | "boot" | "restore" | "page">("loading");
const consentOk = ref(false);
const main = ref<HTMLElement | null>(null);
let poll = 0;

const params = computed(() => Object.fromEntries(Object.entries(route.query).map(([k, v]) => [k, String(Array.isArray(v) ? v[0] : v ?? "")])));
const pg = computed(() => (view.value ? new Page(f.value, view.value, key.value, params.value) : null));

const sections = computed<Section[]>(() => {
  if (!pg.value) return [];
  const pv = pg.value;
  if (key.value === "home") return profileSections(pv, pins.widgets, pins.activity);
  return key.value === "projects" ? projects(pv) : key.value === "evaluations" ? evaluations(pv)
    : key.value === "people" ? people(pv) : key.value === "campus" ? campus(pv) : key.value === "coalition" ? coalition(pv) : [];
});

const profile = computed(() => view.value?.report.profile);
const me = computed(() => state.session?.user);

const title = computed(() => {
  if (key.value !== "home") return f.value.t(`pages.${key.value}`);
  return f.value.t("profile.title");
});
watch([title, () => f.value], () => { document.title = `${title.value} · ${f.value.t("site.name")}`; }, { immediate: true });

async function status(kick = false): Promise<Status> {
  const s = await api<Status>(`/api/me/status${kick ? "?kick=1" : ""}`);
  state.status = s;
  return s;
}

async function load() {
  clearTimeout(poll);
  try {
    if (!state.session?.user) await loadSession();
    if (!state.session?.user) return router.replace("/");
    loadPins(state.session.user.login);
    let s = await status();
    if (s.state === "refused") return router.replace(`/refused?reason=${encodeURIComponent(s.message || "campus")}`);
    if (!s.consent) { screen.value = "consent"; return; }
    if (!s.has_report && ["none", "done"].includes(s.state)) {
      // the server's copy is gone (an hour unused, a restart): this browser hands its own back before anything is extracted
      const login = state.session.user.login;
      if (screen.value !== "page") screen.value = "restore";
      if (await restore(idbShelf, login, state.session.user.csrf, (p, i) => fetch(p, { credentials: "same-origin", ...i }))) {
        await fetchView();
        return freshen(login);
      }
      s = await status(true);
    }
    if (!s.has_report) {
      screen.value = "boot";
      if (s.state !== "failed") poll = window.setTimeout(load, 2000);
      return;
    }
    await fetchView();
    if (["queued", "running"].includes(s.state)) poll = window.setTimeout(watchSync, 2000);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) { state.session = null; return router.replace("/"); }
    throw e;
  }
}

async function fetchView() {
  const period = pagePeriod(key.value, params.value.period || "");
  try {
    view.value = await api<View>(`/api/me/view${period ? `?period=${encodeURIComponent(period)}` : ""}`);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return load(); // forgotten while the page sat open: the copy goes back
    throw e;
  }
  screen.value = "page";
  followCoalitions();
  const u = state.session?.user, last = state.status?.last || "";
  if (u && last && localStorage.getItem(`copy:${u.login}`) !== last) {
    keepCopy(idbShelf, u.login, (p, i) => fetch(p, { credentials: "same-origin", ...i })).then(() => localStorage.setItem(`copy:${u.login}`, last)).catch(() => {});
  }
}

/** A copy handed back shows at once; extracted over an hour ago, a fresh extraction follows in the band. */
async function freshen(login: string) {
  if (!stale(localStorage.getItem(`copy:${login}`))) return;
  const s = await api<Status>("/api/me/refresh", { method: "POST" }).catch((e) => e?.body);
  if (!s?.state) return;
  state.status = { ...state.status!, ...s };
  if (["queued", "running"].includes(s.state)) poll = window.setTimeout(watchSync, 2000);
}

/** While an extraction runs from the band: the bar follows it, the page reloads its data once it is over. */
async function watchSync() {
  const s = await status().catch(() => null);
  if (s && ["queued", "running"].includes(s.state)) { poll = window.setTimeout(watchSync, 2000); return; }
  await fetchView();
}

/** The server refreshes the coalitions' standing on every quarter of the hour: where it shows, the open page follows
 * (half a minute later, the refresh done). */
let live = 0;
function followCoalitions() {
  clearTimeout(live);
  live = window.setTimeout(async () => {
    const v = view.value;
    if (v && main.value?.querySelector(".standings")) {
      const r = await api<{ coalitions: any[] }>("/api/me/coalitions").catch(() => null);
      if (r && v === view.value && JSON.stringify(r.coalitions) !== JSON.stringify(v.coalitions)) view.value = { ...v, coalitions: r.coalitions };
    }
    followCoalitions();
  }, untilQuarter(new Date()) + 30_000);
}

watch([key, () => params.value.period], () => { if (screen.value === "page") fetchView(); else load(); });
load();
onBeforeUnmount(() => { clearTimeout(poll); clearTimeout(live); });

// the field being typed in survives the re-render its own input caused; a link's anchor is reached once drawn
let typingIn: { form: string; name: string; start: number | null; end: number | null } | null = null;
let anchored = "";
watch(sections, async () => {
  await nextTick();
  if (!main.value) return;
  settle(main.value);
  markSections(main.value);
  hideTip();
  if (typingIn) {
    const el = main.value.querySelector<HTMLInputElement>(`form[data-filter="${typingIn.form}"] [name="${typingIn.name}"]`);
    if (el && el.type !== "radio" && el.type !== "checkbox") {
      el.focus({ preventScroll: true });
      if (typingIn.start !== null && "setSelectionRange" in el && el.type === "search") el.setSelectionRange(typingIn.start, typingIn.end);
    } else main.value.querySelector<HTMLElement>(`form[data-filter="${typingIn.form}"] .seg, form[data-filter="${typingIn.form}"]`)?.focus?.();
    typingIn = null;
  }
  if (refocus) { // moved with the keys: the page goes where the widget went
    const grip = main.value.querySelector<HTMLElement>(`[data-widget="${refocus}"] [data-widget-grip]`);
    grip?.focus({ preventScroll: true });
    grip?.scrollIntoView({ block: "center" });
    refocus = "";
  }
  const hash = route.hash;
  if (hash && hash !== anchored) {
    anchored = hash;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }
}, { flush: "post" });

async function accept() {
  await api("/api/me/consent", { method: "POST", body: JSON.stringify({ accept: true }), headers: { "Content-Type": "application/json" } });
  load();
}
async function retry() { await api("/api/me/refresh", { method: "POST" }).catch(() => {}); load(); }

// links inside the pages stay in the app; filter forms write their fields into the address
// every section of a page carries a star by its title; a widget on Profile a handle to move it, its size and a way off
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5-4.8-4.5 6.5-.8z"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="dots" d="M9 5.5h.01M15 5.5h.01M9 12h.01M15 12h.01M9 18.5h.01M15 18.5h.01"/></svg>';
const WIDEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>';
const NARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h7M15 12h7M6 8l4 4-4 4M18 8l-4 4 4 4"/></svg>';
const FOLD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
const UNFOLD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
let refocus = "";
const tool = (cls: string, icon: string, label: string, data: Record<string, string>) => {
  const b = Object.assign(document.createElement("button"), { type: "button", className: `pin ${cls}`, innerHTML: icon, title: label });
  b.setAttribute("aria-label", label);
  Object.assign(b.dataset, data);
  return b;
};
function markSections(root: HTMLElement) {
  const labels = new Map(sections.value.map((s) => [s.id, s.nav]));
  root.querySelectorAll<HTMLElement>(".sec > section[id], .widget > section[id]").forEach((sec) => {
    const widget = sec.parentElement?.dataset.widget;
    const page = widget ? widget.split(":")[0] : key.value;
    const h2 = sec.querySelector<HTMLElement>(":scope > h2, :scope > .panel-head > h2");
    if (!h2 || h2.classList.contains("visually-hidden") || h2.querySelector(".pin")) return;
    if (page === "home") { // on Profile only Activity has tools: fold it, or take it off (the picker brings it back)
      if (sec.id !== "activity") return;
      const label = h2.textContent || sec.id, min = pins.activity === "min";
      const fold = tool("widget-size", min ? UNFOLD : FOLD, f.value.t(min ? "widgets.expand" : "widgets.minimize", { name: label }), { activity: min ? "" : "min" });
      fold.setAttribute("aria-expanded", String(!min));
      h2.append(fold, tool("widget-off", CROSS, f.value.t("widgets.remove", { name: label }), { activity: "off" }));
      return;
    }
    const on = hasPin("stars", page, sec.id), name = labels.get(sec.id) || h2.textContent || sec.id;
    if (!widget) {
      const star = Object.assign(document.createElement("button"), { type: "button", className: "pin star-pin", innerHTML: STAR });
      Object.assign(star.dataset, { pin: `${page}:${sec.id}`, label: name });
      star.setAttribute("aria-pressed", String(on));
      star.setAttribute("aria-label", f.value.t(on ? "pin.unstar" : "pin.star", { name }));
      star.title = star.getAttribute("aria-label")!;
      h2.append(star);
    } else {
      const wide = sec.parentElement!.classList.contains("wide"), wname = sec.parentElement!.dataset.name || name;
      // a span, not a button: Firefox never starts a drag on a button
      const grip = Object.assign(document.createElement("span"), { className: "pin widget-grip", innerHTML: GRIP, tabIndex: 0, draggable: true, title: f.value.t("widgets.move", { name: wname }) });
      grip.setAttribute("role", "button");
      grip.setAttribute("aria-label", grip.title);
      grip.dataset.widgetGrip = widget;
      h2.append(grip, tool("widget-size", wide ? NARROW : WIDEN, f.value.t(wide ? "widgets.half" : "widgets.wide", { name: wname }), { widgetSize: widget }),
        tool("widget-off", CROSS, f.value.t("widgets.remove", { name: wname }), { widgetOff: widget }));
    }
  });
  if (key.value !== "home") relabelStars(key.value, labels);
}

function onClick(ev: MouseEvent) {
  const el = ev.target as Element;
  const star = el.closest?.("[data-pin]") as HTMLElement | null;
  if (star) {
    const [page, id] = star.dataset.pin!.split(":");
    togglePin("stars", { page, id, label: star.dataset.label || id });
    const on = hasPin("stars", page, id), name = star.dataset.label || id;
    star.setAttribute("aria-pressed", String(on));
    star.setAttribute("aria-label", f.value.t(on ? "pin.unstar" : "pin.star", { name }));
    star.title = star.getAttribute("aria-label")!;
    return;
  }
  const fold = el.closest?.("[data-activity]") as HTMLElement | null;
  if (fold) return setActivity(fold.dataset.activity as ActivityState);
  const size = el.closest?.("[data-widget-size]") as HTMLElement | null;
  if (size) {
    const [page, id] = size.dataset.widgetSize!.split(":");
    refocus = "";
    return setWidget(page, id, { wide: !size.closest(".widget")!.classList.contains("wide") });
  }
  const off = el.closest?.("[data-widget-off]") as HTMLElement | null;
  if (off) {
    const [page, id] = off.dataset.widgetOff!.split(":");
    return togglePin("widgets", { page, id, label: "" });
  }
  if (el.closest?.("[data-widget-add]")) {
    const pick = main.value?.querySelector<HTMLSelectElement>("#widgets select")?.value || "";
    const [page, id] = pick.split(":");
    if (page === "home") setActivity("");
    else if (page && id && !hasPin("widgets", page, id)) togglePin("widgets", { page, id, label: "" });
    else return;
    anchored = "";
    router.replace({ query: route.query, hash: `#${id}` });
    return;
  }
  const btn = el.closest?.("[data-preview], [data-download]") as HTMLElement | null;
  if (btn) return exportCsv(btn);
  const a = el.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || a.target || a.hasAttribute("download")) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || !u.pathname.startsWith("/app")) return;
  if (u.pathname === location.pathname && u.search === location.search && u.hash) return; // an anchor on this page
  ev.preventDefault();
  closePops();
  router.push(u.pathname + u.search + (a.hasAttribute("data-keep") ? "" : u.hash));
}

// widgets on Profile: drag a handle onto another widget (before or after it, in the left or right column), or move
// it with the arrow keys on its handle (up and down: the order; left and right: the column of a half widget)
let dragFrom = -1;
// while dragging the page follows the pointer to the band and the window's bottom, so a widget reaches any other
let dragY = -1, following = 0;
const trackDrag = (ev: DragEvent) => { dragY = ev.clientY; };
const dragLeft = (ev: DragEvent) => { if (!ev.relatedTarget) dragY = -1; };
function followDrag() {
  window.scrollBy(0, dragScroll(dragY, document.querySelector(".topbar")?.getBoundingClientRect().bottom || 0, window.innerHeight));
  following = requestAnimationFrame(followDrag);
}
function startFollowing() {
  document.addEventListener("dragover", trackDrag);
  document.addEventListener("dragleave", dragLeft);
  following = requestAnimationFrame(followDrag);
}
function stopFollowing() {
  document.removeEventListener("dragover", trackDrag);
  document.removeEventListener("dragleave", dragLeft);
  cancelAnimationFrame(following);
  dragY = -1;
}
function widgetAt(ev: DragEvent) {
  const grid = main.value?.querySelector<HTMLElement>(".widgets");
  if (!grid || dragFrom < 0) return null;
  const all = [...grid.querySelectorAll<HTMLElement>(":scope > .widget")];
  const two = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length > 1;
  const gr = grid.getBoundingClientRect();
  const side: "left" | "right" | null = two ? (ev.clientX < gr.left + gr.width / 2 ? "left" : "right") : null;
  // the widget under the pointer, else the nearest one
  const dist = (w: HTMLElement) => { const r = w.getBoundingClientRect(); return Math.hypot(Math.max(r.left - ev.clientX, 0, ev.clientX - r.right), Math.max(r.top - ev.clientY, 0, ev.clientY - r.bottom)); };
  const over = all.reduce<HTMLElement | null>((a, w) => (!a || dist(w) < dist(a) ? w : a), null);
  if (!over) return null;
  const r = over.getBoundingClientRect(), i = +over.dataset.i!;
  const across = two && over.classList.contains("half");
  const after = across ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
  // beside a half widget it lands on the side it was dropped on; above or below one, in the column under the pointer
  return { over, to: after ? i + 1 : i, side: across ? (after ? "right" : "left") as "left" | "right" : side, mark: across ? (after ? "right" : "left") : after ? "after" : "before" };
}
const clearDrop = () => main.value?.querySelectorAll("[data-drop]").forEach((w) => w.removeAttribute("data-drop"));
function onDragStart(ev: DragEvent) {
  const w = (ev.target as Element).closest?.("[data-widget-grip]")?.closest(".widget") as HTMLElement | null;
  if (!w || !ev.dataTransfer) return;
  dragFrom = +w.dataset.i!;
  ev.dataTransfer.effectAllowed = "move";
  ev.dataTransfer.setData("text/plain", w.dataset.widget!);
  ev.dataTransfer.setDragImage(w.querySelector("h2") || w, 24, 24); // its title: a tall widget's image would hide where it lands
  hideTip();
  w.classList.add("dragging");
  startFollowing();
}
function onDragOver(ev: DragEvent) {
  const t = widgetAt(ev);
  if (!t) return;
  ev.preventDefault();
  if (t.over.dataset.drop !== t.mark) { clearDrop(); t.over.dataset.drop = t.mark; }
}
function onDrop(ev: DragEvent) {
  const t = widgetAt(ev);
  clearDrop();
  stopFollowing(); // the drop redraws the page: dragend may never reach the handle
  if (!t) return;
  ev.preventDefault();
  const moved = pins.widgets[dragFrom];
  const half = main.value?.querySelector(`[data-widget="${moved.page}:${moved.id}"]`)?.classList.contains("half");
  moveWidget(dragFrom, t.to);
  if (half && t.side) setWidget(moved.page, moved.id, { side: t.side });
  dragFrom = -1;
}
function onDragEnd() {
  dragFrom = -1;
  stopFollowing();
  clearDrop();
  main.value?.querySelectorAll(".widget.dragging").forEach((w) => w.classList.remove("dragging"));
}
function onKey(ev: KeyboardEvent) {
  const w = (ev.target as Element).closest?.("[data-widget-grip]")?.closest(".widget") as HTMLElement | null;
  if (!w) return;
  const i = +w.dataset.i!, [page, id] = w.dataset.widget!.split(":");
  if (ev.key === "ArrowUp") moveWidget(i, i - 1);
  else if (ev.key === "ArrowDown") moveWidget(i, i + 2);
  else if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && w.classList.contains("half")) setWidget(page, id, { side: ev.key === "ArrowLeft" ? "left" : "right" });
  else return;
  ev.preventDefault();
  refocus = w.dataset.widget!;
}

let typing = 0;
function onInput(ev: Event) {
  const form = (ev.target as Element).closest?.("form[data-filter]") as HTMLFormElement | null;
  if (!form) return;
  clearTimeout(typing);
  const t = ev.target as HTMLInputElement;
  typingIn = { form: form.dataset.filter || "", name: t.name, start: t.type === "search" ? t.selectionStart : null, end: t.type === "search" ? t.selectionEnd : null };
  const apply = () => {
    const q: Record<string, string> = { ...params.value };
    for (const el of Array.from(form.elements) as HTMLInputElement[]) {
      if (!el.name) continue;
      if (el.type === "checkbox") { if (el.checked) q[el.name] = el.value; else delete q[el.name]; }
      else if (el.type === "radio") { if (el.checked) q[el.name] = el.value; }
      else if (el.value) q[el.name] = el.value; else delete q[el.name];
    }
    router.replace({ query: q, hash: route.hash });
  };
  if ((ev.target as HTMLInputElement).type === "search") typing = window.setTimeout(apply, 300); else apply();
}

const preview = ref<HTMLDialogElement | null>(null);
const previewTitle = ref(""), previewHtml = ref("");
function exportCsv(btn: HTMLElement) {
  if (!pg.value) return;
  const kind = btn.dataset.preview || btn.dataset.download;
  const text = kind === "portfolio" ? portfolioCsv(pg.value) : projectsCsv(pg.value);
  if (btn.dataset.download) {
    const name = kind === "portfolio" ? `portfolio-${profile.value?.login}.csv` : `projects-${params.value.track || pg.value.period}.csv`;
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }
  const [head = [], ...rows] = parseCsv(text);
  previewTitle.value = btn.dataset.title || "";
  previewHtml.value = `<table aria-label="${esc(previewTitle.value)}"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>`
    + `<tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  hideTip(); closePops();
  preview.value?.showModal();
}

const periods = computed(() => (view.value && view.value.periods.length > 1 ? view.value.periods : []));
const periodHref = (p: string) => router.resolve({ query: { ...params.value, period: p } }).fullPath;
// Coalition keeps to the student period: its switch shows it and changes nothing, the chosen period waits in the address
const locked = computed(() => pagePeriod(key.value, "") !== "");
</script>

<template>
  <AppHeader :page="key" :period="params.period || view?.period" :periods="periods" @refreshed="watchSync" />
  <main v-if="screen === 'page'" id="main" ref="main" :data-page="`web-${key}`" @click="onClick" @input="onInput" @change="onInput" @submit.prevent
    @keydown="onKey" @dragstart="onDragStart" @dragover="onDragOver" @drop="onDrop" @dragend="onDragEnd">
    <header class="page-head">
      <h1>{{ title }}</h1>
      <nav v-if="periods.length" class="seg periods" :aria-label="f.t('rail.period')">
        <a v-for="p in periods" :key="p" :href="locked ? undefined : periodHref(p)" data-keep role="button" :aria-pressed="p === view?.period"
          :aria-disabled="locked && p !== view?.period ? 'true' : undefined" :title="locked ? f.t('period.student_only') : undefined">{{ f.t(`period.${p}`) }}</a>
      </nav>
      <p v-else-if="key === 'home' && state.status?.last" class="periods only">{{ f.t("today.as_of", { time: f.stamp(new Date(state.status.last).getTime()) }) }}</p>
    </header>
    <nav v-if="sections.length > 1 && key !== 'home'" class="toc" :aria-label="f.t('rail.sections')"><a v-for="s in sections" :key="s.id" :href="`#${s.id}`">{{ s.nav }}</a></nav>
    <div v-for="s in sections" :key="s.id + key" class="sec" v-html="s.html"></div>
    <footer class="site-foot">
      <SiteCredit />
      <nav class="foot-links"><RouterLink to="/about">{{ f.t("site.about") }}</RouterLink><RouterLink to="/privacy">{{ f.t("site.privacy") }}</RouterLink>
        <a v-if="state.session?.issues_url" :href="state.session.issues_url" rel="noopener" target="_blank">{{ f.t("site.issues") }}</a></nav>
      <p class="foot-note">{{ f.t(view?.light && !view?.seat_days ? "footer.light" : "footer.full", { when: f.dayTime(view?.report.generated) }) }}</p>
    </footer>
  </main>
  <main v-else-if="screen === 'consent'" id="main" class="solo">
    <div class="boot-panel">
      <h2>{{ f.t("consent.title") }}</h2>
      <p>{{ f.t("consent.lede", { version: state.session?.consent_version ?? "" }) }}</p>
      <form class="signin" @submit.prevent="consentOk && accept()">
        <label class="consent"><input v-model="consentOk" type="checkbox" required />
          <span>{{ f.t("site.accept").split("{privacy}")[0] }}<RouterLink to="/privacy" target="_blank">{{ f.t("site.accept_link") }}</RouterLink>{{ f.t("site.accept").split("{privacy}")[1] }}</span></label>
        <p class="row-btns"><button class="btn primary" type="submit" :disabled="!consentOk">{{ f.t("consent.continue") }}</button></p>
      </form>
    </div>
  </main>
  <!-- loading, a copy coming back from this browser or the first extraction: on Profile your card, the rest in grey -->
  <main v-else id="main" class="skel" :data-page="`web-${key}`" :aria-busy="screen !== 'boot' || state.status?.state !== 'failed'">
    <header class="page-head"><h1>{{ title }}</h1>
      <p v-if="screen !== 'boot'" :class="screen === 'restore' ? 'periods only' : 'visually-hidden'" role="status">{{ f.t(screen === "restore" ? "restore.lede" : "boot.title") }}</p>
      <p v-else-if="state.status?.state === 'failed'" class="periods only" role="status"><b>{{ f.t("boot.failed") }}</b><br />
        <button class="btn primary" type="button" @click="retry">{{ f.t("boot.retry") }}</button></p>
      <p v-else-if="state.status && state.status.next_refresh_in > 0 && ['none', 'done'].includes(state.status.state)" class="periods only" role="status">
        <b>{{ state.status.next_refresh_in < 60 ? f.t("refresh.wait_s", { count: state.status.next_refresh_in }) : f.t("refresh.wait", { count: Math.ceil(state.status.next_refresh_in / 60) }) }}</b> {{ f.t("boot.wait_note") }}</p>
      <p v-else class="periods only" role="status"><b>{{ f.t(state.status?.message || `status.${state.status?.state || 'queued'}`) }}</b> {{ f.t("boot.first") }}</p>
    </header>
    <section v-if="me && key === 'home'" id="profile" :aria-label="f.t('profile.title')"><div class="pf">
      <div class="avatar-lg pf-photo"><span aria-hidden="true">{{ initials(me.name || me.login) }}</span>
        <img v-if="me.has_image" :src="'/avatar/me'" alt="" @error="($event.target as HTMLElement).remove()" /></div>
      <div class="pf-main"><p class="pf-name">{{ me.name || me.login }}</p><p class="pf-sub"><span>{{ me.login }}</span></p>
        <div class="pf-stacks" aria-hidden="true"><dl v-for="n in 3" :key="n"><div v-for="r in 2" :key="r"><dt><i class="sk"></i></dt><dd><i class="sk"></i></dd></div></dl></div></div>
    </div></section>
    <section class="modules-wrap" aria-hidden="true"><div class="modules">
      <article v-for="n in 3" :key="n" class="module"><h3 class="tab"><i class="sk"></i></h3><p class="figure"><i class="sk"></i></p><i class="sk"></i><i class="sk"></i><i class="sk tall"></i></article>
    </div></section>
  </main>
  <div id="tip" role="tooltip"></div>
  <Teleport to="#dialogs">
    <dialog ref="preview" class="preview" aria-labelledby="preview-title" @click="($event.target as Element) === preview && preview?.close()">
      <div class="preview-head"><h2 id="preview-title">{{ previewTitle }}</h2><button class="btn secondary" type="button" @click="preview?.close()">{{ f.t("landing.close") }}</button></div>
      <div class="table-wrap tall" v-html="previewHtml"></div>
    </dialog>
  </Teleport>
</template>
