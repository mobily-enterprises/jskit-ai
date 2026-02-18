<template>
  <v-app class="god-root">
    <template v-if="showApplicationShell">
      <v-app-bar border density="comfortable" elevation="0" class="god-bar">
        <v-toolbar-title class="god-title">God Console</v-toolbar-title>
        <v-spacer />
        <v-btn variant="text" class="mr-1" @click="goToGodHome">Home</v-btn>
        <v-btn v-if="canViewMembers" variant="text" class="mr-1" @click="goToGodMembers">Members</v-btn>
        <v-btn variant="text" class="mr-1" @click="goToAccountSettings">Account settings</v-btn>
        <v-btn variant="text" @click="signOut">Sign out</v-btn>
      </v-app-bar>

      <v-main class="god-main-shell">
        <v-container fluid class="god-content px-3 px-sm-5 py-4">
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
import { useGodShell } from "./useGodShell";

export default {
  name: "GodShell",
  components: {
    Outlet
  },
  setup() {
    const { layout, permissions, actions } = useGodShell();
    return {
      ...layout,
      ...permissions,
      ...actions
    };
  }
};
</script>

<style scoped>
.god-root {
  background-color: rgb(var(--v-theme-background));
}

.god-bar {
  background-color: rgb(var(--v-theme-surface));
  border-bottom: 2px solid rgba(15, 107, 84, 0.25);
}

.god-title {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.god-main-shell {
  background: linear-gradient(180deg, rgba(15, 107, 84, 0.08), rgba(15, 107, 84, 0) 220px),
    rgb(var(--v-theme-background));
}

.god-content {
  max-width: 1280px;
  margin-inline: auto;
}
</style>
