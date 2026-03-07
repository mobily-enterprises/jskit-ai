<script setup>
import SurfaceShell from "../../components/shell/SurfaceShell.vue";

const topLeftActions = [
  { label: "Workspace", to: "/app" },
  { label: "Console", to: "/console" }
];

const topRightActions = [
  { label: "Alerts", to: "/console" },
  { label: "Settings", to: "/admin" }
];

const menuItems = [
  { label: "Diagnostics", to: "/console", icon: "$console" },
  { label: "Jobs", to: "/console", icon: "$playCircle" },
  { label: "Logs", to: "/console", icon: "$fileDocumentOutline" }
];
</script>

<template>
  <SurfaceShell
    surface-label="Console"
    title="Console surface is ready."
    subtitle="Use this area for diagnostics, operational tooling, and advanced workflows."
    :top-left-actions="topLeftActions"
    :top-right-actions="topRightActions"
    :menu-items="menuItems"
  >
    <v-card rounded="lg" border elevation="0">
      <v-card-text class="text-medium-emphasis">
        Replace this area with your console tools.
      </v-card-text>
    </v-card>
  </SurfaceShell>
</template>
