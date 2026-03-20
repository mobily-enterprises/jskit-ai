<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "home"
    }
  }
}
</route>

<script setup>
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import ShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";

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
  <ShellLayout title="" subtitle="">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <template #prepend>
          <v-chip color="primary" size="small" label>Home</v-chip>
        </template>
        <v-card-title class="text-h5">welcome</v-card-title>
        <v-card-subtitle>Main public surface</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text class="d-flex flex-column ga-4">
        <div class="d-flex flex-wrap ga-3">
          <v-chip color="secondary" variant="tonal" label>Route: /</v-chip>
          <v-chip color="info" variant="tonal" label>Health: {{ health }}</v-chip>
        </div>
        <p class="text-medium-emphasis mb-0">
          This is your primary landing page. Replace this content with your actual product home.
        </p>
        <div class="d-flex flex-wrap ga-3">
          <v-btn color="primary" variant="flat" to="/console">Open console surface</v-btn>
          <v-btn color="secondary" variant="outlined" to="/auth/signout">Sign out</v-btn>
        </div>
      </v-card-text>
    </v-card>
  </ShellLayout>
</template>
