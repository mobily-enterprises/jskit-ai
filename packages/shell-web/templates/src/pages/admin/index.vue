<script setup>
import ShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";

const topLeftActions = [
  { label: "Workspace", to: "/app" },
  { label: "Admin", to: "/admin" }
];

const topRightActions = [
  { label: "Alerts", to: "/console" },
  { label: "Profile", to: "/app" }
];

const menuItems = [
  { label: "Overview", to: "/admin", icon: "$viewDashboard" },
  { label: "Users", to: "/admin", icon: "$accountGroup" },
  { label: "System", to: "/admin", icon: "$cog" }
];
</script>

<template>
  <ShellLayout
    surface="admin"
    surface-label="Admin"
    title="Admin surface is ready."
    subtitle="Manage platform settings, operators, and governance from this surface."
    :top-left-actions="topLeftActions"
    :top-right-actions="topRightActions"
    :menu-items="menuItems"
  >
    <v-card rounded="lg" border elevation="0">
      <v-card-text class="text-medium-emphasis">
        Replace this area with your admin modules.
      </v-card-text>
    </v-card>
  </ShellLayout>
</template>
