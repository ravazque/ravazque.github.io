<script setup lang="ts">
// The five app pages. Asks for the status first (consent, a report, an extraction running), then the period's view
// (and Home's today), builds the sections as markup and lets the browser behaviours take it from there.
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { HttpError, api, fmt, loadSession, state, type Status } from "../state";
import { closePops, hideTip, settle } from "../lib/behave";
import { idbShelf, keepCopy, restore } from "../lib/copy";
import { esc } from "../lib/h";
import { parseCsv } from "../lib/table";
import { Page, type PageKey, type Section, type View } from "../views/page";
import type { Today } from "../views/home";
import { ON_PROFILE, profile as profileSections } from "../views/profile";
import { portfolioCsv, projects, projectsCsv } from "../views/projects";
import { evaluations } from "../views/evaluations";
import { people } from "../views/people";
import { campus } from "../views/campus";
import AppHeader from "./AppHeader.vue";
import SiteCredit from "./SiteCredit.vue";

const route = useRoute(), router = useRouter();
const f = computed(() => fmt.value);
const key = computed<PageKey>(() => ((route.params.page as string) || "home") as PageKey);
const view = shallowRef<View | null>(null);
const today = shallowRef<Today | null>(null);
const screen = ref<"loading" | "consent" | "boot" | "restore" | "page">("loading");
const consentOk = ref(false);
const main = ref<HTMLElement | null>(null);
let poll = 0;

const params = computed(() => Object.fromEntries(Object.entries(route.query).map(([k, v]) => [k, String(Array.isArray(v) ? v[0] : v ?? "")])));
const pg = computed(() => (view.value ? new Page(f.value, view.value, key.value, params.value) : null));

const sections = computed<Section[]>(() => {
  if (!pg.value) return [];
  if (key.value === "home") return profileSections(pg.value, today.value);
  // the panels v1's Home held live on Profile again: the other pages leave them out
  return { projects, evaluations, people, campus }[key.value as Exclude<PageKey, "home">](pg.value).filter((s) => !ON_PROFILE.has(s.id));
});

const profile = computed(() => view.value?.report.profile);

const title = computed(() => {
  if (key.value !== "home") return f.value.t(`pages.${key.value}`);
  return f.value.t("profile.title");
});
watch([title, () => f.value], () => { document.title = `${title.value} · ${f.value.t("site.name")}`; }, { immediate: true });

async function status(): Promise<Status> {
  const s = await api<Status>("/api/me/status?kick=1");
  state.status = s;
  return s;
}

async function load() {
  clearTimeout(poll);
  try {
    if (!state.session?.user) await loadSession();
    if (!state.session?.user) return router.replace("/");
    const s = await status();
    if (s.state === "refused") return router.replace(`/refused?reason=${encodeURIComponent(s.message || "campus")}`);
    if (!s.consent) { screen.value = "consent"; return; }
    if (!s.has_report) {
      if (s.state === "done") { // the server's copy is gone (an hour unused, a restart): this browser hands its own back
        screen.value = "restore";
        const login = state.session.user.login;
        if (await restore(idbShelf, login, state.session.user.csrf, (p, i) => fetch(p, { credentials: "same-origin", ...i }))) return load();
        await api("/api/me/refresh", { method: "POST" }).catch(() => {});
        return load();
      }
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
  const period = params.value.period || "";
  const [v, td] = await Promise.all([
    api<View>(`/api/me/view${period ? `?period=${encodeURIComponent(period)}` : ""}`),
    key.value === "home" ? api<Today>("/api/me/today") : Promise.resolve(null),
  ]);
  view.value = v;
  today.value = td;
  screen.value = "page";
  const u = state.session?.user, last = state.status?.last || "";
  if (u && last && localStorage.getItem(`copy:${u.login}`) !== last) {
    keepCopy(idbShelf, u.login, (p, i) => fetch(p, { credentials: "same-origin", ...i })).then(() => localStorage.setItem(`copy:${u.login}`, last)).catch(() => {});
  }
}

/** While an extraction runs from the band: the bar follows it, the page reloads its data once it is over. */
async function watchSync() {
  const s = await status().catch(() => null);
  if (s && ["queued", "running"].includes(s.state)) { poll = window.setTimeout(watchSync, 2000); return; }
  await fetchView();
}

watch([key, () => params.value.period], () => { if (screen.value === "page") fetchView(); else load(); });
load();
onBeforeUnmount(() => clearTimeout(poll));

// the field being typed in survives the re-render its own input caused; a link's anchor is reached once drawn
let typingIn: { form: string; name: string; start: number | null; end: number | null } | null = null;
let anchored = "";
watch(sections, async () => {
  await nextTick();
  if (!main.value) return;
  settle(main.value);
  hideTip();
  if (typingIn) {
    const el = main.value.querySelector<HTMLInputElement>(`form[data-filter="${typingIn.form}"] [name="${typingIn.name}"]`);
    if (el && el.type !== "radio" && el.type !== "checkbox") {
      el.focus({ preventScroll: true });
      if (typingIn.start !== null && "setSelectionRange" in el && el.type === "search") el.setSelectionRange(typingIn.start, typingIn.end);
    } else main.value.querySelector<HTMLElement>(`form[data-filter="${typingIn.form}"] .seg, form[data-filter="${typingIn.form}"]`)?.focus?.();
    typingIn = null;
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
function onClick(ev: MouseEvent) {
  const el = ev.target as Element;
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
</script>

<template>
  <AppHeader :page="key" :period="view?.period" @refreshed="watchSync" />
  <main v-if="screen === 'page'" id="main" ref="main" :data-page="`web-${key}`" @click="onClick" @input="onInput" @change="onInput" @submit.prevent>
    <header class="page-head">
      <h1>{{ title }}</h1>
      <nav v-if="periods.length" class="seg periods" :aria-label="f.t('rail.period')">
        <a v-for="p in periods" :key="p" :href="periodHref(p)" data-keep role="button" :aria-pressed="p === view?.period">{{ f.t(`period.${p}`) }}</a>
      </nav>
      <p v-else-if="key === 'home' && state.status?.last" class="periods only">{{ f.t("today.as_of", { time: f.stamp(new Date(state.status.last).getTime()) }) }}</p>
    </header>
    <nav v-if="sections.length > 1" class="toc" :aria-label="f.t('rail.sections')"><a v-for="s in sections" :key="s.id" :href="`#${s.id}`">{{ s.nav }}</a></nav>
    <div v-for="s in sections" :key="s.id + key" class="sec" v-html="s.html"></div>
    <footer class="site-foot">
      <SiteCredit />
      <nav class="foot-links"><RouterLink to="/about">{{ f.t("site.about") }}</RouterLink><RouterLink to="/privacy">{{ f.t("site.privacy") }}</RouterLink>
        <a v-if="state.session?.issues_url" :href="state.session.issues_url" rel="noopener" target="_blank">{{ f.t("site.issues") }}</a></nav>
      <p class="foot-note">{{ f.t(view?.light && !view?.seat_days ? "footer.light" : "footer.full", { when: f.dayTime(view?.report.generated) }) }}</p>
    </footer>
  </main>
  <main v-else id="main" class="solo">
    <div v-if="screen === 'consent'" class="boot-panel">
      <h2>{{ f.t("consent.title") }}</h2>
      <p>{{ f.t("consent.lede", { version: state.session?.consent_version ?? "" }) }}</p>
      <form class="signin" @submit.prevent="consentOk && accept()">
        <label class="consent"><input v-model="consentOk" type="checkbox" required />
          <span>{{ f.t("site.accept").split("{privacy}")[0] }}<RouterLink to="/privacy" target="_blank">{{ f.t("site.accept_link") }}</RouterLink>{{ f.t("site.accept").split("{privacy}")[1] }}</span></label>
        <p class="row-btns"><button class="btn primary" type="submit" :disabled="!consentOk">{{ f.t("consent.continue") }}</button></p>
      </form>
    </div>
    <div v-else-if="screen === 'boot'" class="boot-panel" aria-live="polite">
      <h2>{{ f.t("boot.title") }}</h2>
      <template v-if="state.status?.state === 'failed'">
        <p>{{ f.t("boot.failed") }}</p>
        <p><button class="btn primary" type="button" @click="retry">{{ f.t("boot.retry") }}</button></p>
      </template>
      <template v-else-if="state.status && state.status.next_refresh_in > 0 && ['none', 'done'].includes(state.status.state)">
        <p>{{ state.status.next_refresh_in < 60 ? f.t("refresh.wait_s", { count: state.status.next_refresh_in }) : f.t("refresh.wait", { count: Math.ceil(state.status.next_refresh_in / 60) }) }}</p>
        <p class="note">{{ f.t("boot.wait_note") }}</p>
      </template>
      <template v-else>
        <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(100 * (state.status?.progress || 0))"><i :style="{ width: Math.round(100 * (state.status?.progress || 0)) + '%' }"></i></div>
        <p>{{ f.t(state.status?.message || `status.${state.status?.state || 'queued'}`) }}</p>
        <p class="note">{{ f.t("boot.first") }}</p>
      </template>
    </div>
    <div v-else class="boot-panel"><h2>{{ f.t("boot.title") }}</h2><p>{{ screen === "restore" ? f.t("restore.lede") : "" }}</p></div>
  </main>
  <div id="tip" role="tooltip"></div>
  <Teleport to="#dialogs">
    <dialog ref="preview" class="preview" aria-labelledby="preview-title" @click="($event.target as Element) === preview && preview?.close()">
      <div class="preview-head"><h2 id="preview-title">{{ previewTitle }}</h2><button class="btn secondary" type="button" @click="preview?.close()">{{ f.t("landing.close") }}</button></div>
      <div class="table-wrap tall" v-html="previewHtml"></div>
    </dialog>
  </Teleport>
</template>
