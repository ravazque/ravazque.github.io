<script setup lang="ts">
// Asked before acting: "Delete my data" and the owner's publish to the public site.
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, fmt, loadSession, state } from "../state";
import { forget, idbShelf } from "../lib/copy";
import AppHeader from "./AppHeader.vue";

const props = defineProps<{ kind: "delete" | "publish" }>();
const f = computed(() => fmt.value);
const router = useRouter();
const result = ref<{ ok: boolean; url?: string; error?: string } | null>(null);
const working = ref(false);
onMounted(async () => {
  if (!state.session?.user) await loadSession().catch(() => null);
  if (!state.session?.user) return router.replace("/");
  if (props.kind === "publish" && !state.session.user.can_publish) router.replace("/app");
  document.title = `${f.value.t(`${props.kind}.title`)} · ${f.value.t("site.name")}`;
});

async function yes() {
  working.value = true;
  if (props.kind === "delete") {
    const login = state.session!.user!.login;
    await forget(idbShelf, login);
    localStorage.removeItem(`copy:${login}`);
    await api("/api/me/delete", { method: "POST" }).catch(() => {});
    state.session = null;
    state.status = null;
    return router.replace("/");
  }
  try {
    const r = await api<{ url: string }>("/api/me/publish", { method: "POST" });
    result.value = { ok: true, url: r.url };
  } catch (e: any) {
    result.value = { ok: false, error: e.body?.error || "github" };
  }
  working.value = false;
}
</script>

<template>
  <AppHeader />
  <main id="main" class="solo">
    <div class="boot-panel">
      <h2>{{ f.t(`${kind}.title`) }}</h2>
      <template v-if="result">
        <p v-if="result.ok">{{ f.t("publish.done") }} · <a :href="result.url" target="_blank" rel="noopener">{{ f.t("publish.view") }}</a></p>
        <p v-else>{{ f.t(`publish.error_${result.error}`) }}</p>
        <p class="row-btns"><RouterLink class="btn secondary" to="/app">{{ f.t("brand.name") }}</RouterLink></p>
      </template>
      <template v-else>
        <p>{{ f.t(`${kind}.confirm`) }}</p>
        <p class="row-btns">
          <button class="btn primary" type="button" :disabled="working" @click="yes">{{ f.t(`${kind}.yes`) }}</button>
          <RouterLink class="btn secondary" to="/app">{{ f.t(`${kind}.no`) }}</RouterLink>
        </p>
      </template>
    </div>
  </main>
  <div id="tip" role="tooltip"></div>
</template>
