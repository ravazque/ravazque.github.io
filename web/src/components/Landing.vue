<script setup lang="ts">
// The landing: who it is for, the policy to accept, sign in with 42, and the accent field behind the mark.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { fmt, loadSession, state } from "../state";
import { startLanding } from "../legacy/field.js";
import Mark from "./Mark.vue";
import SiteLinks from "./SiteLinks.vue";

const f = computed(() => fmt.value);
const route = useRoute(), router = useRouter();
const accept = ref(false), going = ref(false);
const plan = ref<HTMLElement | null>(null), features = ref<HTMLDialogElement | null>(null);
const error = computed(() => (["signin", "consent"].includes(String(route.query.error)) ? String(route.query.error) : ""));
let stop: (() => void) | undefined;

onMounted(async () => {
  document.title = f.value.t("site.name");
  if (plan.value) stop = startLanding(plan.value);
  const s = await loadSession().catch(() => null);
  if (s?.user) router.replace("/app");
});
onBeforeUnmount(() => stop?.());

function signIn() {
  if (!accept.value) return;
  going.value = true;
  document.documentElement.classList.add("leaving");
  location.href = "/auth/login?accept=1";
}
const acceptParts = computed(() => f.value.t("site.accept").split("{privacy}"));
</script>

<template>
  <main class="landing">
    <section ref="plan" class="landing-plan" aria-hidden="true"><Mark /></section>
    <section class="landing-text">
      <h1>{{ f.t("site.name") }}</h1>
      <p class="tagline">{{ f.t("site.tagline") }}</p>
      <p class="pitch">{{ f.t("site.pitch") }}</p>
      <p v-if="error" class="error" role="alert">{{ f.t(error === "consent" ? "site.error_consent" : "site.error_signin") }}</p>
      <form class="signin" @submit.prevent="signIn">
        <label class="consent"><input v-model="accept" type="checkbox" required />
          <span>{{ acceptParts[0] }}<RouterLink to="/privacy">{{ f.t("site.accept_link") }}</RouterLink>{{ acceptParts[1] }}</span></label>
        <div class="signin-actions">
          <button class="btn primary" type="submit" :disabled="!accept || going" :aria-busy="going || undefined" :title="accept ? '' : f.t('landing.accept_first')">
            {{ going ? f.t("landing.signing_in") : f.t("site.signin") }}</button>
          <a class="btn secondary" href="/about#features" aria-haspopup="dialog" @click.prevent="features?.showModal()">{{ f.t("landing.features_button") }}</a>
        </div>
      </form>
      <p v-if="state.session?.dev_logins?.length" class="dev-logins"><a v-for="d in state.session.dev_logins" :key="d.href" class="btn secondary" :href="d.href">{{ d.label }}</a></p>
      <p class="note">{{ f.t("site.only_madrid") }} {{ f.t("site.independent") }}</p>
      <SiteLinks />
    </section>
    <Teleport to="#dialogs">
      <dialog ref="features" class="features" :aria-label="f.t('landing.features_button')" @click="($event.target as Element) === features && !going && features?.close()" @cancel="going && $event.preventDefault()">
        <div class="features-body">
          <ul class="features-grid"><li v-for="k in ['time', 'evals', 'projects', 'people', 'coalition', 'profile']" :key="k"><h3>{{ f.t(`landing.f_${k}_t`) }}</h3><p>{{ f.t(`landing.f_${k}`) }}</p></li></ul>
          <div class="features-actions">
            <button class="btn secondary" type="button" :disabled="going" @click="features?.close()">{{ f.t("landing.close") }}</button>
            <button class="btn primary" type="button" :disabled="!accept || going" :title="accept ? '' : f.t('landing.accept_first')" @click="signIn">{{ going ? f.t("landing.signing_in") : f.t("site.signin") }}</button>
          </div>
        </div>
      </dialog>
    </Teleport>
  </main>
</template>
