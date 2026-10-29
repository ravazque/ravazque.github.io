<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { fmt } from "../state";
import Mark from "./Mark.vue";
import SiteLinks from "./SiteLinks.vue";

const f = computed(() => fmt.value);
const route = useRoute();
const reason = computed(() => (["staff", "piscine", "blackholed", "frozen", "campus"].includes(String(route.query.reason)) ? String(route.query.reason) : "unknown"));
onMounted(() => { document.title = `${f.value.t("refused.title")} · ${f.value.t("site.name")}`; });
</script>

<template>
  <header class="site-head"><RouterLink class="brand" to="/"><Mark /><span>{{ f.t("site.name") }}</span></RouterLink><SiteLinks /></header>
  <main class="site-main">
    <h1>{{ f.t("refused.title") }}</h1>
    <p class="lede">{{ f.t(`refused.${reason}`) }}</p>
    <p class="note">{{ f.t("refused.nothing_stored") }}</p>
    <p><RouterLink class="btn secondary" to="/">{{ f.t("refused.back") }}</RouterLink></p>
  </main>
</template>
