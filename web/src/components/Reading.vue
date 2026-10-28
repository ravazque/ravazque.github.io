<script setup lang="ts">
// About and Privacy: reading pages from the texts, with a way back.
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useRouter } from "vue-router";
import { fmt, loadSession, state } from "../state";
import SiteLinks from "./SiteLinks.vue";
import Mark from "./Mark.vue";

const props = defineProps<{ page: "about" | "privacy" }>();
const f = computed(() => fmt.value);
const router = useRouter();
const heading = computed(() => f.value.t(`${props.page}.title`));
const raw = (k: string) => fmt.value.raw(k) as any;
const sections = computed(() => (raw("policy.sections") as string[] | undefined) || []);
const fill = (s: string) => s.replace("{controller}", state.session?.controller || "").replace("{email}", state.session?.contact_email || "");
const back = computed(() => (window.history.state?.back as string | null) || "/");
onMounted(() => { document.body.classList.add("site"); if (!state.session) loadSession().catch(() => {}); });
onBeforeUnmount(() => document.body.classList.remove("site"));
const title = computed(() => `${heading.value} · ${f.value.t("site.name")}`);
onMounted(() => { document.title = title.value; });
</script>

<template>
  <header class="site-head"><RouterLink class="brand" to="/"><Mark /><span>{{ f.t("site.name") }}</span></RouterLink><SiteLinks :current="page" /></header>
  <main class="site-main reading">
    <h1>{{ heading }}</h1>
    <template v-if="page === 'about'">
      <h2>{{ f.t("about.h_why") }}</h2>
      <p class="lede">{{ f.t("about.why") }}</p>
      <p>{{ f.t("about.p1") }}</p>
      <h2 id="features">{{ f.t("about.h_features") }}</h2>
      <ul class="features-list"><li v-for="n in 13" :key="n">{{ f.t(`about.feature_${n}`) }}</li></ul>
      <h2>{{ f.t("about.h_how") }}</h2>
      <dl class="stack">
        <div><dt>{{ f.t("about.k_pages") }}</dt><dd>{{ f.t("about.pages") }}</dd></div>
        <div><dt>{{ f.t("about.k_backend") }}</dt><dd>{{ f.t("about.backend") }}</dd></div>
        <div><dt>{{ f.t("about.k_infra") }}</dt><dd>{{ f.t("about.infra") }}</dd></div>
      </dl>
      <h2>{{ f.t("about.h_who") }}</h2>
      <p>{{ f.t("about.p2") }}</p><p>{{ f.t("about.p3") }}</p><p>{{ f.t("about.p4") }}</p>
      <h2>{{ f.t("about.h_beta") }}</h2>
      <p>{{ f.t("about.beta") }}</p>
      <p class="note">{{ f.t("about.contact", { email: state.session?.contact_email || "" }) }}</p>
    </template>
    <template v-else>
      <template v-for="sec in sections" :key="sec">
        <h2>{{ f.t(`policy.${sec}.title`) }}</h2>
        <ul v-if="raw(`policy.${sec}.list`)"><li v-for="item in raw(`policy.${sec}.list`)" :key="item">{{ item }}</li></ul>
        <p v-for="p in raw(`policy.${sec}.body`) || []" :key="p">{{ fill(p) }}</p>
      </template>
      <p class="note">{{ f.t("policy.version", { version: state.session?.consent_version ?? "", updated: state.session?.consent_updated || "" }) }}</p>
    </template>
  </main>
  <footer class="reading-foot"><a class="back" :href="back" @click.prevent="router.push(back)">{{ f.t("site.back") }}</a><SiteLinks :current="page" /></footer>
</template>
