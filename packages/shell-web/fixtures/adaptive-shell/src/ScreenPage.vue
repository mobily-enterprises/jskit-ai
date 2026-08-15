<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const title = computed(() => String(route.meta.title || "Shell fixture"));
</script>

<template>
  <main tabindex="-1">
    <h1>{{ title }}</h1>
    <p>Package-owned browser fixture for the adaptive shell contract.</p>
  </main>
</template>
