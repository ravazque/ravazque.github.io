<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
const route = useRoute();
// the five app pages share one dashboard (switching pages keeps the loaded report); every other page stands alone
const key = computed(() => (/^\/app(\/(projects|evaluations|people|campus))?\/?$/.test(route.path) ? "app" : route.path));
</script>

<template>
  <RouterView :key="key" />
</template>
