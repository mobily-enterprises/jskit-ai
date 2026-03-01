<script setup>
import { computed } from "vue";
import { Outlet, useLocation } from "@tanstack/vue-router";
import { useDisplay } from "vuetify";
import { createShellHostRuntime } from "./runtime/useShellHost.js";
import { listShellEntriesBySlot, resolveSurfaceFromPathname } from "./runtime/filesystemHost.console.js";
import { evaluateShellGuard } from "./runtime/guardRuntime.js";
import GlobalNetworkActivityBar from "./runtime/GlobalNetworkActivityBar.vue";
import { useShellContext } from "./runtime/useShellContext.js";
import { createSignOutRoute, isPublicAuthPath } from "./runtime/publicAuthPaths.js";

const { mobile } = useDisplay();
const isMobile = computed(() => Boolean(mobile.value));

const {
  drawerModel,
  currentSurface,
  drawerEntries,
  topEntries,
  configEntries,
  surfaceLabel,
  activeTitle,
  isActive,
  toggleDrawer,
  goToEntry
} = createShellHostRuntime({
  listShellEntriesBySlot,
  resolveSurfaceFromPathname,
  evaluateShellGuard
});

const {
  workspaceThemeStyle,
  workspaceItems,
  activeWorkspace,
  alertsPreviewEntries,
  unreadAlertsCount,
  realtimeStatusLabel,
  realtimeStatusColor,
  userDisplayName,
  userInitials,
  selectWorkspace,
  openAlert
} = useShellContext({ goToEntry });

const settingsRoute = computed(() => {
  const surface = String(currentSurface.value || "app");
  if (surface === "console") {
    return "";
  }
  if (surface === "app") {
    return "/app/settings";
  }
  return `/${surface}/settings`;
});

const signOutRoute = computed(() => createSignOutRoute(currentSurface.value));
const location = useLocation();
const isPublicAuthRoute = computed(() => isPublicAuthPath(location.value?.pathname || ""));
</script>

<template>
  <v-app class="shell-host bg-background" :style="workspaceThemeStyle">
    <template v-if="isPublicAuthRoute">
      <v-main>
        <Outlet />
      </v-main>
    </template>

    <template v-else>
      <GlobalNetworkActivityBar />

    <v-app-bar border density="comfortable" elevation="0" class="shell-app-bar bg-surface">
      <v-app-bar-nav-icon
        :aria-label="isMobile ? 'Toggle navigation drawer' : 'Toggle navigation menu'"
        @click="toggleDrawer"
      />

      <v-menu location="bottom start" offset="8">
        <template #activator="{ props: menuProps }">
          <v-btn v-bind="menuProps" variant="text" class="workspace-switcher-button text-none">
            <v-avatar color="primary" size="28" class="mr-2">
              <span class="text-caption font-weight-bold">{{ activeWorkspace?.name?.slice(0, 2) || "WS" }}</span>
            </v-avatar>
            <span class="d-inline-block text-truncate" style="max-width: 180px">{{ activeWorkspace?.name }}</span>
          </v-btn>
        </template>
        <v-list density="comfortable" min-width="260">
          <v-list-subheader>Workspaces</v-list-subheader>
          <v-list-item
            v-for="workspace in workspaceItems"
            :key="workspace.id || workspace.slug"
            :title="workspace.name"
            :subtitle="`/${workspace.slug}`"
            :active="workspace.slug === activeWorkspace?.slug"
            @click="selectWorkspace(workspace)"
          />
        </v-list>
      </v-menu>

      <v-toolbar-title class="text-subtitle-1 font-weight-bold ms-2">
        <span class="accent-pill" />
        {{ activeTitle || surfaceLabel }}
      </v-toolbar-title>

      <div class="shell-top-links d-flex align-center ga-2">
        <v-btn
          v-for="entry in topEntries"
          :key="entry.id"
          variant="text"
          class="text-none"
          :prepend-icon="entry.icon || undefined"
          :color="isActive(entry.resolvedRoute) ? 'primary' : undefined"
          @click="goToEntry(entry)"
        >
          {{ entry.title }}
        </v-btn>
      </div>

      <v-spacer />

      <v-chip size="small" :color="realtimeStatusColor" variant="tonal" class="mr-2">
        {{ realtimeStatusLabel }}
      </v-chip>

      <v-menu location="bottom end" offset="8">
        <template #activator="{ props: alertProps }">
          <v-badge :content="unreadAlertsCount" :model-value="unreadAlertsCount > 0" color="error" location="top end">
            <v-btn v-bind="alertProps" icon="$menuAlerts" variant="text" aria-label="Open alerts menu" />
          </v-badge>
        </template>
        <v-list density="comfortable" min-width="320">
          <v-list-subheader>Alerts</v-list-subheader>
          <v-list-item v-if="alertsPreviewEntries.length < 1" title="No alerts yet." />
          <v-list-item
            v-for="alert in alertsPreviewEntries"
            :key="alert.id"
            :title="alert.title"
            :subtitle="alert.message || alert.type"
            @click="openAlert(alert)"
          />
        </v-list>
      </v-menu>

      <v-menu location="bottom end" offset="8">
        <template #activator="{ props: settingsProps }">
          <v-btn v-bind="settingsProps" icon="$menuSettings" variant="text" aria-label="Open settings menu" />
        </template>
        <v-list density="comfortable" min-width="220">
          <v-list-item
            v-for="entry in configEntries"
            :key="entry.id"
            :title="entry.title"
            :prepend-icon="entry.icon || undefined"
            @click="goToEntry(entry)"
          />
          <v-list-item v-if="configEntries.length < 1" title="No config entries" />
        </v-list>
      </v-menu>

      <v-menu location="bottom end" offset="8">
        <template #activator="{ props: userProps }">
          <v-btn v-bind="userProps" class="text-none" variant="text">
            <v-avatar size="30" color="secondary" class="mr-2">
              <span class="text-caption font-weight-bold">{{ userInitials }}</span>
            </v-avatar>
            <span class="d-none d-sm-inline-flex">{{ userDisplayName }}</span>
          </v-btn>
        </template>
        <v-list density="comfortable" min-width="200">
          <v-list-item
            v-if="settingsRoute"
            title="Account settings"
            @click="goToEntry({ resolvedRoute: settingsRoute })"
          />
          <v-divider />
          <v-list-item title="Sign out" @click="goToEntry({ resolvedRoute: signOutRoute })" />
        </v-list>
      </v-menu>
    </v-app-bar>

    <v-navigation-drawer v-model="drawerModel" :temporary="isMobile" class="bg-surface">
      <v-list density="comfortable">
        <v-list-subheader>Navigation</v-list-subheader>
        <v-list-item
          v-for="entry in drawerEntries"
          :key="entry.id"
          :title="entry.title"
          :prepend-icon="entry.icon || undefined"
          :active="isActive(entry.resolvedRoute)"
          @click="goToEntry(entry)"
        />
      </v-list>
    </v-navigation-drawer>

    <v-main>
      <div class="shell-main pa-6">
        <Outlet />
      </div>
    </v-main>
    </template>
  </v-app>
</template>

<style scoped>
.shell-host {
  min-height: 100vh;
}

.shell-app-bar {
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.accent-pill {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: var(--workspace-color, #0f6b54);
  margin-right: 8px;
}

.shell-main {
  max-width: 1200px;
  margin: 0 auto;
}
</style>
