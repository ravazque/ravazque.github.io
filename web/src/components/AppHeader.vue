<script setup lang="ts">
// The band on top of every app page: brand, pages, the sync state, the highlights, and you (photo, login, level,
// coalition) opening your settings and account.
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api, fmt, setLang, settings, state } from "../state";
import { applyAccentChoice, applyTheme, setTheme, type Theme } from "../lib/look";
import { closePops } from "../lib/behave";
import { forget, idbShelf } from "../lib/copy";
import { PAGES, PATHS, type PageKey } from "../views/page";
import BrandMark from "./BrandMark.vue";
import { offline } from "../offline";

const props = defineProps<{ page?: PageKey; period?: string }>();
const emit = defineEmits<{ refreshed: [] }>();
const router = useRouter();
const f = computed(() => fmt.value);
const user = computed(() => state.session?.user);
const status = computed(() => state.status);
const theme = ref<Theme>(applyTheme(settings.get("theme")));
const accent = ref(applyAccentChoice(settings.get("accent"), user.value?.coalition_color));
watch(() => user.value?.coalition_color, (c) => { accent.value = applyAccentChoice(settings.get("accent"), c); });

const label = (k: PageKey) => f.value.t(`pages.${k}`);
const href = (k: PageKey) => PATHS[k] + (props.period ? `?period=${props.period}` : "");

const busy = computed(() => ["queued", "running"].includes(status.value?.state || ""));
const waitText = (s: number) => (s < 60 ? f.value.t("refresh.wait_s", { count: Math.max(1, s) }) : f.value.t("refresh.wait", { count: Math.ceil(s / 60) }));
const syncWait = computed(() => {
  const s = status.value;
  if (!s) return "";
  if (busy.value) return f.value.t(s.message || `status.${s.state}`);
  if (s.state === "failed") return f.value.t("status.failed");
  return s.next_refresh_in > 0 ? `[${waitText(s.next_refresh_in)}]` : "";
});
const lastText = computed(() => (status.value?.last ? f.value.t("refresh.last", { when: f.value.stampNum(new Date(status.value.last).getTime()) }) : ""));
const fresh = computed(() => !!status.value?.last && Date.now() - new Date(status.value.last).getTime() < 3600e3);

async function refresh() {
  try { state.status = { ...state.status!, ...(await api("/api/me/refresh", { method: "POST" })) }; } catch (e: any) { if (e.body?.state) state.status = { ...state.status!, ...e.body }; }
  emit("refreshed");
}

function pickTheme(t: Theme) { theme.value = t; setTheme(t); accent.value = applyAccentChoice(settings.get("accent"), user.value?.coalition_color); }
function pickAccent(a: "intra" | "coalition") { settings.set("accent", a); accent.value = applyAccentChoice(a, user.value?.coalition_color); }

async function signOut() {
  if (user.value) await forget(idbShelf, user.value.login);
  await api("/auth/logout", { method: "POST" }).catch(() => {});
  // a full load, not a route change: nothing of this account stays in memory for Back to show
  location.replace("/");
}

const tour = ref(false);
onMounted(() => { tour.value = !offline && !settings.get("tour:star") && props.page !== undefined; });
function tourDone() { tour.value = false; settings.set("tour:star", "1"); }
function go(path: string) { closePops(); router.push(path); }
</script>

<template>
  <a class="skip" href="#main">{{ f.t("a11y.skip") }}</a>
  <header class="topbar">
    <RouterLink class="brand" to="/app" :aria-label="f.t('brand.name')"><BrandMark /><span>{{ f.t("brand.name") }}</span></RouterLink>
    <nav v-if="page" class="pages" :aria-label="f.t('pages.label')">
      <RouterLink v-for="k in PAGES" :key="k" :to="href(k)" :aria-current="k === page ? 'page' : undefined">{{ label(k) }}</RouterLink>
    </nav>
    <div class="topbar-end">
      <div v-if="status && !offline" class="sync" aria-live="polite">
        <span v-if="lastText" class="last">{{ lastText }}</span>
        <span v-if="syncWait" :class="busy ? 'visually-hidden' : 'wait'">{{ syncWait }}</span>
        <div v-if="busy" class="progress"><i :style="{ width: Math.round(100 * (status.progress || 0)) + '%' }"></i></div>
        <button class="btn on-band" type="button" :disabled="busy || status.next_refresh_in > 0 || status.frozen" @click="refresh">{{ f.t("refresh.button") }}</button>
      </div>
      <div v-if="page" class="best-anchor">
        <details class="pop best-wrap" @toggle="($event.target as HTMLDetailsElement).open && tourDone()">
          <summary class="best" :aria-label="f.t('best.label')" :title="f.t('best.label')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path class="star" d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5-4.8-4.5 6.5-.8z" /></svg>
            <svg class="caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
          </summary>
          <nav class="best-menu" :aria-label="f.t('best.label')">
            <a v-for="b in [['/app#today', 'today.bonus', 'today.title'], ['/app/campus#seats', 'seats.title', 'pages.campus'], ['/app/campus#days', 'days.title', 'pages.campus'],
                            ['/app/people#who', 'who.title', 'pages.people'], ['/app/people#circle', 'network.title', 'pages.people'],
                            ['/app/evaluations#in-depth', 'depth.given_title', 'pages.evaluations'], ['/app/evaluations#log', 'log.title', 'pages.evaluations']]"
               :key="b[0]" :href="b[0]" @click.prevent="go(b[0])">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg>
              <span>{{ f.t(b[1]) }}<small>{{ f.t(b[2]) }}</small></span>
            </a>
          </nav>
        </details>
        <template v-if="tour">
          <div class="tour-shade" @click="tourDone"></div>
          <div class="tour" role="dialog" aria-labelledby="tour-t">
            <p id="tour-t"><b>{{ f.t("tour.star_title") }}</b></p><p>{{ f.t("tour.star") }}</p>
            <button class="btn secondary" type="button" @click="tourDone">{{ f.t("tour.ok") }}</button>
          </div>
        </template>
      </div>
      <details class="pop settings-wrap">
        <summary class="gear" :aria-label="f.t('settings.label')" :title="f.t('settings.label')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
        </summary>
        <div class="settings" role="group" :aria-label="f.t('settings.label')">
          <p class="s-label">{{ f.t("settings.accent") }}</p>
          <div class="theme" role="group" :aria-label="f.t('settings.accent')">
            <button type="button" :aria-pressed="accent === 'intra'" @click="pickAccent('intra')">{{ f.t("settings.accent_intra") }}</button>
            <button type="button" :aria-pressed="accent === 'coalition'" :disabled="!user?.coalition_color" @click="pickAccent('coalition')">{{ f.t("settings.accent_coalition") }}</button>
          </div>
          <p class="s-label">{{ f.t("theme.label") }}</p>
          <div class="theme" role="group" :aria-label="f.t('theme.label')">
            <button v-for="t in (['auto', 'light', 'dark'] as Theme[])" :key="t" type="button" :aria-pressed="theme === t" @click="pickTheme(t)">{{ f.t(`theme.${t}`) }}</button>
          </div>
          <p class="s-label">{{ f.t("settings.language") }}</p>
          <div class="theme" role="group" :aria-label="f.t('settings.language')">
            <button type="button" :aria-pressed="f.lang === 'en'" @click="setLang('en')">EN</button><button type="button" :aria-pressed="f.lang === 'es'" @click="setLang('es')">ES</button>
          </div>
          <template v-if="!offline">
          <p class="s-label">{{ f.t("settings.account") }}</p>
          <div v-if="user?.can_publish" class="publish">
            <a class="btn primary" href="/app/publish" :aria-disabled="!fresh || busy" @click.prevent="fresh && !busy && go('/app/publish')">{{ f.t("publish.button") }}</a>
            <p v-if="!fresh && !busy" class="wait">{{ f.t("publish.stale") }}</p>
            <p v-else-if="status?.published" class="wait">{{ f.t("publish.last", { when: f.stamp(new Date(status.published).getTime()) }) }}</p>
          </div>
          <div class="row-links">
            <a v-if="user?.owner" class="btn secondary go" href="/app/stats" @click.prevent="go('/app/stats')">{{ f.t("stats.button") }}</a>
            <button class="btn secondary" type="button" @click="signOut">{{ f.t("signout.button") }}</button>
            <a class="btn secondary danger" href="/app/delete" @click.prevent="go('/app/delete')">{{ f.t("delete.button") }}</a>
          </div>
          </template>
        </div>
      </details>
      <details v-if="page" class="pop menu-wrap">
        <summary class="gear menu-btn" :aria-label="f.t('pages.label')" :title="f.t('pages.label')">
          <svg class="open" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          <svg class="shut" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </summary>
        <nav class="menu" :aria-label="f.t('pages.label')">
          <a v-for="k in PAGES" :key="k" :href="href(k)" :aria-current="k === page ? 'page' : undefined" @click.prevent="go(href(k))">{{ label(k) }}</a>
        </nav>
      </details>
    </div>
  </header>
</template>
