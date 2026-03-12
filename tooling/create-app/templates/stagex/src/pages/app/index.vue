<script setup>
import { computed, onMounted, ref } from "vue";

const appTitle = "__APP_TITLE__";
const title = "";
const health = ref("loading...");

const healthColor = computed(() => {
  if (health.value === "ok") {
    return "success";
  }
  if (health.value === "loading...") {
    return "info";
  }
  return "error";
});

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
  <v-card rounded="lg" elevation="1" border>
    <v-card-item>
      <template #prepend>
        <v-chip color="primary" size="small" label>App</v-chip>
      </template>
      <v-card-title class="text-h5">{{ title }}</v-card-title>
      <v-card-subtitle>{{ appTitle }} main workspace surface</v-card-subtitle>
    </v-card-item>
    <v-divider />
    <v-card-text class="d-flex flex-column ga-4">
      <div class="d-flex flex-wrap ga-3">
        <v-chip color="secondary" variant="tonal" label>Route: /app</v-chip>
        <v-chip :color="healthColor" variant="tonal" label>Health: {{ health }}</v-chip>
      </div>
      <p class="text-medium-emphasis mb-0">
        This is your primary app landing page. Replace this content with your actual dashboard.
      </p>
      <div class="d-flex flex-wrap ga-3">
        <v-btn color="primary" variant="flat" to="/app">Open app home</v-btn>
        <v-btn color="secondary" variant="outlined" to="/auth/signout">Sign out</v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>
