<script setup>
import { onMounted, ref } from "vue";
import ShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";

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
  <ShellLayout
    surface="app"
    surface-label="Web"
    title="Web shell is ready."
    subtitle="Base shell container for all surfaces."
  >
    <v-card rounded="lg" border elevation="0">
      <v-card-text class="d-flex align-center ga-2">
        <span class="text-medium-emphasis">Service health:</span>
        <v-chip size="small" color="info" variant="tonal" label>{{ health }}</v-chip>
      </v-card-text>
    </v-card>
  </ShellLayout>
</template>
