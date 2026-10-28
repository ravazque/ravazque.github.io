<script setup lang="ts">
// About, Privacy, the issues link and the language switch, under the public pages.
import { computed } from "vue";
import { fmt, setLang, state } from "../state";
defineProps<{ current?: string }>();
const f = computed(() => fmt.value);
</script>

<template>
  <nav class="site-links">
    <RouterLink to="/about" :aria-current="current === 'about' ? 'page' : undefined">{{ f.t("site.about") }}</RouterLink>
    <RouterLink to="/privacy" :aria-current="current === 'privacy' ? 'page' : undefined">{{ f.t("site.privacy") }}</RouterLink>
    <a v-if="state.session?.issues_url" :href="state.session.issues_url" rel="noopener" target="_blank">{{ f.t("site.issues") }}</a>
    <div class="lang" role="group" :aria-label="f.t('site.language')">
      <button type="button" :aria-pressed="f.lang === 'en'" @click="setLang('en')">EN</button><button type="button" :aria-pressed="f.lang === 'es'" @click="setLang('es')">ES</button>
    </div>
  </nav>
</template>
