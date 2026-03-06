<script setup>
import { onMounted, ref } from "vue";

const appTitle = "__APP_TITLE__";
const title = "It worked!";
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
    <p>{{ appTitle }} is running with filesystem routing from <code>src/pages</code>.</p>
    <p><strong>Health:</strong> {{ health }}</p>
  </section>
</template>
