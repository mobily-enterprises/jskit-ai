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
  <v-card rounded="lg" elevation="1" border>
    <v-card-item class="home-surface-card__header">
      <template #prepend>
        <v-chip color="primary" size="small" label>Home</v-chip>
      </template>
      <v-card-title class="text-h5">welcome</v-card-title>
      <v-card-subtitle>Main public surface</v-card-subtitle>
    </v-card-item>
    <v-divider />
    <v-card-text class="home-surface-card__body d-flex flex-column ga-3">
      <div class="d-flex flex-wrap ga-3">
        <v-chip color="secondary" variant="tonal" label>Route: /home</v-chip>
        <v-chip color="info" variant="tonal" label>Health: {{ health }}</v-chip>
      </div>
      <p class="text-medium-emphasis mb-0">
        This is your primary landing page. Replace this content with your actual product home.
      </p>
      <p class="text-body-2 text-medium-emphasis mb-0">Use the navigation drawer to move around the shell.</p>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.home-surface-card__header {
  padding: 0.875rem 1rem;
}

.home-surface-card__body {
  padding: 0.875rem 1rem 1rem;
}
</style>
