<script setup>
import { onMounted, ref } from "vue";
import SurfaceShell from "../components/shell/SurfaceShell.vue";

const appTitle = "__APP_TITLE__";
const health = ref("loading...");

const topLeftActions = [
  { label: "Workspace", to: "/app" },
  { label: "Home", to: "/" }
];

const topRightActions = [
  { label: "Alerts", to: "/console" },
  { label: "Settings", to: "/admin" }
];

const menuItems = [
  { label: "App", to: "/app", icon: "$home" },
  { label: "Admin", to: "/admin", icon: "$settings" },
  { label: "Console", to: "/console", icon: "$console" }
];

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
  <SurfaceShell
    surface-label="Web"
    :title="`${appTitle} shell`"
    subtitle="Base shell container for all surfaces."
    :top-left-actions="topLeftActions"
    :top-right-actions="topRightActions"
    :menu-items="menuItems"
  >
    <v-card rounded="lg" border elevation="0">
      <v-card-text class="d-flex align-center ga-2">
        <span class="text-medium-emphasis">Service health:</span>
        <v-chip size="small" color="info" variant="tonal" label>{{ health }}</v-chip>
      </v-card-text>
    </v-card>
  </SurfaceShell>
</template>
