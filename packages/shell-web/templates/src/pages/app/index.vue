<script setup>
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";

const healthQuery = useQuery({
  queryKey: ["shell-web", "health"],
  queryFn: async () => {
    const response = await fetch("/api/health");
    if (!response.ok) {
      throw new Error("Health request failed.");
    }
    return response.json();
  },
  refetchOnWindowFocus: false
});

const health = computed(() => {
  if (healthQuery.isPending.value || healthQuery.isFetching.value) {
    return "loading...";
  }

  if (healthQuery.error.value) {
    return "unreachable";
  }

  return healthQuery.data.value?.ok ? "ok" : "unhealthy";
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
