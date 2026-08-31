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
  <section class="home-surface-screen d-flex flex-column ga-4">
    <div class="home-surface-screen__actions">
      <v-btn color="primary" variant="flat" to="/home/settings/general">Settings</v-btn>
    </div>

    <v-sheet rounded="lg" border class="home-surface-screen__panel">
      <div class="home-surface-screen__status">
        <span class="text-caption text-medium-emphasis">Service health</span>
        <strong>{{ health }}</strong>
      </div>
      <v-divider vertical class="d-none d-sm-block" />
      <div class="home-surface-screen__status">
        <span class="text-caption text-medium-emphasis">Route</span>
        <strong>/home</strong>
      </div>
    </v-sheet>
  </section>
</template>

<style scoped>
.home-surface-screen {
  --home-surface-panel-padding: 1rem;
}

.home-surface-screen__actions {
  display: flex;
  justify-content: flex-end;
}

.home-surface-screen__panel {
  align-items: stretch;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  padding: var(--home-surface-panel-padding);
}

.home-surface-screen__status {
  display: grid;
  gap: 0.15rem;
  min-width: 9rem;
}

@media (max-width: 640px) {
  .home-surface-screen__actions :deep(.v-btn) {
    min-height: 48px;
    width: 100%;
  }
}
</style>
