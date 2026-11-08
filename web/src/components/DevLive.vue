<script setup lang="ts">
// make dev-live only, for the owner (AppHeader loads it in Vite's dev server alone: production builds hold none of it,
// so its texts live here instead of the shipped language files). The server forgets your report as after an hour unused
// and extracts it again from 42 (~110 requests), to see this browser's copy come back and the refresh run in the band.
import { computed } from "vue";
import { api, fmt, state } from "../state";

const es = computed(() => fmt.value.lang === "es");
const busy = computed(() => ["queued", "running"].includes(state.status?.state || ""));

async function goLive() {
  await api("/dev/live", { method: "POST" });
  localStorage.removeItem(`copy:${state.session!.user!.login}`); // the copy's age unknown: it counts as old, so the refresh follows
  location.reload();
}
</script>

<template>
  <div class="publish">
    <button class="btn secondary" type="button" :disabled="busy" @click="goLive">{{ es ? "Probar: tras una hora" : "Test: back after an hour" }}</button>
  </div>
</template>
