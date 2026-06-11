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
  <section class="generated-ui-screen generated-ui-screen--app home-surface-screen d-flex flex-column ga-4">
    <header class="home-surface-screen__header">
      <div>
        <p class="text-overline text-medium-emphasis mb-1">Home</p>
        <h1 class="home-surface-screen__title">Ready</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Core services are available.
        </p>
      </div>
      <v-btn color="primary" variant="flat" to="/home/settings/general">Settings</v-btn>
    </header>

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
.generated-ui-screen {
  --generated-ui-screen-title-size: 2rem;
  --generated-ui-screen-panel-padding: 1rem;
}

.home-surface-screen__header {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.home-surface-screen__title {
  font-size: var(--generated-ui-screen-title-size);
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.1;
  margin: 0 0 0.4rem;
}

.home-surface-screen__panel {
  align-items: stretch;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  padding: var(--generated-ui-screen-panel-padding);
}

.home-surface-screen__status {
  display: grid;
  gap: 0.15rem;
  min-width: 9rem;
}

@media (max-width: 640px) {
  .generated-ui-screen {
    --generated-ui-screen-title-size: 1.5rem;
  }

  .home-surface-screen__header {
    flex-direction: column;
  }

  .home-surface-screen__header :deep(.v-btn) {
    min-height: 48px;
    width: 100%;
  }
}
</style>
