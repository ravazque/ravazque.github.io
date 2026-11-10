<script setup lang="ts">
// make dev-live only, for the owner (AppHeader loads it in Vite's dev server alone: production builds hold none of it,
// so its texts live here instead of the shipped language files). The server forgets your report as after an hour unused
// and extracts it again from 42 (~110 requests), to see this browser's copy come back and the refresh run in the band.
// Two more, with no extraction: the first extraction's loading screen held on every page (devsim's hold scenario, until
// turned off), and the draw-in of charts and figures as on the session's first visit.
import { computed, ref } from "vue";
import { api, fmt, state } from "../state";
import { HOLD } from "../devsim";
import { replayDrawIn } from "../lib/behave";

const es = computed(() => fmt.value.lang === "es");
const busy = computed(() => ["queued", "running"].includes(state.status?.state || ""));
const holding = ref(!!sessionStorage.getItem(HOLD));

function toggleHold() {
  if (holding.value) sessionStorage.removeItem(HOLD); else sessionStorage.setItem(HOLD, "1");
  const u = new URL(location.href);
  u.searchParams.delete("sim");
  location.replace(u.href);
}

async function goLive() {
  await api("/dev/live", { method: "POST" });
  localStorage.removeItem(`copy:${state.session!.user!.login}`); // the copy's age unknown: it counts as old, so the refresh follows
  location.reload();
}
</script>

<template>
  <div class="publish">
    <button class="btn secondary" type="button" :disabled="busy" @click="goLive">{{ es ? "Probar: tras una hora" : "Test: back after an hour" }}</button>
    <button class="btn secondary" type="button" :aria-pressed="holding" @click="toggleHold">{{ holding ? (es ? "Quitar pantalla de carga" : "Hide loading screen") : (es ? "Ver pantalla de carga" : "Show loading screen") }}</button>
    <button class="btn secondary" type="button" @click="replayDrawIn">{{ es ? "Repetir animaciones" : "Replay animations" }}</button>
  </div>
</template>
