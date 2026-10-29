<script setup lang="ts">
// The owner's live operations page: API budget, extractions, the process and who is signed in.
import { computed, onBeforeUnmount, onMounted, shallowRef } from "vue";
import { useRouter } from "vue-router";
import { api, fmt, loadSession, state } from "../state";
import { S1, hbars } from "../lib/charts";
import AppHeader from "./AppHeader.vue";

const f = computed(() => fmt.value);
const router = useRouter();
const s = shallowRef<any>(null);
let timer = 0;
async function load() {
  try { s.value = await api("/api/stats"); } catch { return router.replace("/app"); }
  timer = window.setTimeout(load, 10000);
}
onMounted(async () => {
  if (!state.session?.user) await loadSession().catch(() => null);
  if (!state.session?.user?.owner) return router.replace("/app");
  document.title = `${f.value.t("stats.title")} · ${f.value.t("site.name")}`;
  load();
});
onBeforeUnmount(() => clearTimeout(timer));

const dur = (sec: number) => {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
const tiles = computed(() => {
  const x = s.value, F = f.value;
  if (!x) return null;
  const n = x.extractions, hour = x.last_hour.reduce((a: number, b: number) => a + b, 0);
  return {
    api: [[F.t("stats.requests_total"), F.num(x.requests_total)], [F.t("stats.requests_hour"), F.num(hour)]],
    chart: hbars(F, x.last_hour.map((_: number, i: number) => F.t("stats.app", { n: i + 1 })), [[F.t("stats.used"), x.last_hour, S1]], { label: F.t("stats.api_title"), end: (_i, v) => F.num(v), big: true }),
    ext: [[F.t("stats.ext_total"), F.num(n)], [F.t("stats.ext_queued"), F.num(x.queued)],
      [F.t("stats.ext_avg_req"), n ? F.num(Math.round(x.extraction_requests / n)) : "–"],
      [F.t("stats.ext_avg_time"), n ? F.t("stats.secs", { n: F.num(Math.round(x.extraction_seconds / n)) }) : "–"],
      [F.t("stats.failed"), F.num(x.failed)], [F.t("stats.timeouts"), F.num(x.timeouts)], [F.t("stats.denied"), F.num(x.denied)]],
    sys: [[F.t("stats.uptime"), dur(x.uptime_s)], [F.t("stats.memory"), F.num(x.memory_keys)], [F.t("stats.peak"), F.num(x.peak_sessions)]],
    note: `${F.t("stats.started")} ${F.stamp(new Date(x.started).getTime())} · ${F.t("stats.last_publish")} ${x.last_publish ? F.stamp(new Date(x.last_publish).getTime()) : F.t("stats.never")}`,
  };
});
</script>

<template>
  <AppHeader />
  <main v-if="tiles" id="main">
    <section class="stats-sec"><h2>{{ f.t("stats.api_title") }}</h2>
      <div class="stat-tiles"><div v-for="[k, v] in tiles.api" :key="k" class="stat"><b class="figure">{{ v }}</b><span class="k">{{ k }}</span></div></div>
      <div v-html="tiles.chart"></div></section>
    <section class="stats-sec"><h2>{{ f.t("stats.ext_title") }}</h2>
      <div class="stat-tiles"><div v-for="[k, v] in tiles.ext" :key="k" class="stat"><b class="figure">{{ v }}</b><span class="k">{{ k }}</span></div></div></section>
    <section class="stats-sec"><h2>{{ f.t("stats.sys_title") }}</h2>
      <div class="stat-tiles"><div v-for="[k, v] in tiles.sys" :key="k" class="stat"><b class="figure">{{ v }}</b><span class="k">{{ k }}</span></div></div>
      <p class="note">{{ tiles.note }}</p></section>
    <section class="stats-sec"><h2>{{ f.t("stats.sessions") }}<span class="count"><span class="sep"> · </span>{{ s.sessions?.length || 0 }}</span></h2>
      <ul v-if="s.sessions?.length" class="stat-sessions"><li v-for="u in s.sessions" :key="u.login + u.created"><span class="who">{{ u.login }}<template v-if="u.name"> · {{ u.name }}</template></span><span class="when">{{ f.stamp(u.created * 1000) }}</span></li></ul>
      <p v-else class="note">{{ f.t("stats.no_sessions") }}</p></section>
  </main>
  <div id="tip" role="tooltip"></div>
</template>
