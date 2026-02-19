<template>
  <v-app class="console-root">
    <template v-if="showApplicationShell">
      <v-app-bar border density="comfortable" elevation="0" class="console-bar">
        <v-app-bar-nav-icon
          :disabled="isDesktopPermanentDrawer && !isMobile"
          :aria-label="isDesktopCollapsible ? 'Toggle navigation drawer' : 'Toggle navigation menu'"
          @click="toggleDrawer"
        />

        <v-toolbar-title class="console-title">{{ destinationTitle }}</v-toolbar-title>
        <v-spacer />

        <v-menu location="bottom end" offset="8">
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" class="user-menu-button px-2" aria-label="Open user menu">
              <span class="user-menu-name">{{ userDisplayName }}</span>
            </v-btn>
          </template>

          <v-list density="comfortable" min-width="220">
            <v-list-item prepend-icon="$menuSettings" title="Account settings" @click="goToAccountSettings" />
            <v-divider class="my-1" />
            <v-list-item prepend-icon="$menuLogout" title="Sign out" @click="signOut" />
          </v-list>
        </v-menu>
      </v-app-bar>

      <v-navigation-drawer
        v-model="drawerModel"
        :permanent="!isMobile && isDesktopPermanentDrawer"
        :temporary="isMobile"
        :scrim="isMobile"
        :width="272"
        class="console-drawer"
        border
      >
        <v-list nav density="comfortable" class="pt-2">
          <v-list-item
            v-for="item in navigationItems"
            :key="item.to"
            :title="item.title"
            :prepend-icon="item.icon"
            :active="isCurrentPath(item.to)"
            rounded="lg"
            @click="goToNavigationItem(item)"
          />
        </v-list>
      </v-navigation-drawer>

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
    const { layout, user, permissions, navigation, actions } = useConsoleShell();
    return {
      ...layout,
      ...user,
      ...permissions,
      ...navigation,
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

.console-drawer {
  background-color: rgb(var(--v-theme-surface));
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

.user-menu-button {
  min-width: 42px;
  text-transform: none;
}

.user-menu-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9rem;
  font-weight: 500;
}

:deep(.v-navigation-drawer .v-list-item) {
  margin-bottom: 4px;
}

:deep(.v-navigation-drawer .v-list-item--active) {
  background-color: rgba(15, 107, 84, 0.15);
}
</style>
