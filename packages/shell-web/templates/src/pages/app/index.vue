<script setup>
import { onMounted, ref } from "vue";

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
  <v-card rounded="lg" border elevation="0">
    <v-card-text class="d-flex align-center ga-2">
      <span class="text-medium-emphasis">Service health:</span>
      <v-chip size="small" color="info" variant="tonal" label>{{ health }}</v-chip>
    </v-card-text>
  </v-card>
</template>
