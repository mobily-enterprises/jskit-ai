<script setup>
import { onMounted, ref } from "vue";

const appTitle = "__APP_TITLE__";
const title = "App surface is ready.";
const health = ref("loading...");

onMounted(async () => {
  try {
    const response = await fetch("/api/v1/health");
    const payload = await response.json();
    health.value = payload?.ok ? "ok" : "unhealthy";
  } catch {
    health.value = "unreachable";
  }
});
</script>

<template>
  <section>
    <h1>{{ title }}</h1>
    <p>{{ appTitle }} route: <code>/app</code></p>
    <p><strong>Health:</strong> {{ health }}</p>
  </section>
</template>
