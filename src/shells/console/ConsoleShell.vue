<template>
  <v-app class="console-root">
    <template v-if="showApplicationShell">
      <v-app-bar border density="comfortable" elevation="0" class="console-bar">
        <v-toolbar-title class="console-title">Console</v-toolbar-title>
        <v-spacer />
        <v-btn variant="text" class="mr-1" @click="goToConsoleHome">Home</v-btn>
        <v-btn v-if="canViewMembers" variant="text" class="mr-1" @click="goToConsoleMembers">Members</v-btn>
        <v-btn variant="text" class="mr-1" @click="goToAccountSettings">Account settings</v-btn>
        <v-btn variant="text" @click="signOut">Sign out</v-btn>
      </v-app-bar>

      <v-main class="console-main-shell">
        <v-container fluid class="console-content px-3 px-sm-5 py-4">
          <Outlet />
        </v-container>
      </v-main>
    </template>

    <template v-else>
      <Outlet />
    </template>
  </v-app>
</template>

<script>
import { Outlet } from "@tanstack/vue-router";
import { useConsoleShell } from "./useConsoleShell";

export default {
  name: "ConsoleShell",
  components: {
    Outlet
  },
  setup() {
    const { layout, permissions, actions } = useConsoleShell();
    return {
      ...layout,
      ...permissions,
      ...actions
    };
  }
};
</script>

<style scoped>
.console-root {
  background-color: rgb(var(--v-theme-background));
}

.console-bar {
  background-color: rgb(var(--v-theme-surface));
  border-bottom: 2px solid rgba(15, 107, 84, 0.25);
}

.console-title {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.console-main-shell {
  background: linear-gradient(180deg, rgba(15, 107, 84, 0.08), rgba(15, 107, 84, 0) 220px),
    rgb(var(--v-theme-background));
}

.console-content {
  max-width: 1280px;
  margin-inline: auto;
}
</style>
