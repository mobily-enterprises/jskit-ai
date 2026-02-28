<script setup>
import { computed, ref } from "vue";
import { Outlet, useNavigate, useRouterState } from "@tanstack/vue-router";
import { useDisplay } from "vuetify";
import { listShellEntriesBySlot, resolveSurfaceFromPathname } from "./filesystemHost.js";
import { evaluateShellGuard } from "./guardRuntime.js";

const { mobile } = useDisplay();
const drawerModel = ref(true);
const navigate = useNavigate();

const currentPath = useRouterState({
  select: (state) => state.location.pathname
});

const currentSurface = computed(() => resolveSurfaceFromPathname(currentPath.value));
const shellEntries = computed(() => listShellEntriesBySlot(currentSurface.value));

function filterEntriesByGuard(entries) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const outcome = evaluateShellGuard({
      guard: entry?.guard,
      phase: "navigation",
      context: {
        pathname: currentPath.value,
        surface: currentSurface.value,
        slot: entry?.slot || ""
      }
    });

    return outcome.allow;
  });
}

const drawerEntries = computed(() => filterEntriesByGuard(shellEntries.value.drawer));
const topEntries = computed(() => filterEntriesByGuard(shellEntries.value.top));
const configEntries = computed(() => filterEntriesByGuard(shellEntries.value.config));

const surfaceLabel = computed(() => {
  const surface = String(currentSurface.value || "app");
  return surface.charAt(0).toUpperCase() + surface.slice(1);
});

function isActive(pathname) {
  const current = String(currentPath.value || "");
  const target = String(pathname || "");
  if (!target || target === "/") {
    return current === "/";
  }
  return current === target || current.startsWith(`${target}/`);
}

const isMobile = computed(() => Boolean(mobile.value));

const workspaceThemeStyle = computed(() => ({
  "--workspace-color": "#0f6b54",
  "--workspace-color-soft": "rgba(15, 107, 84, 0.12)",
  "--workspace-color-strong": "rgba(15, 107, 84, 0.18)"
}));

const activeTitle = computed(() => {
  const candidate = [...drawerEntries.value, ...topEntries.value].find((entry) => isActive(entry.resolvedRoute));
  return candidate?.title || `${surfaceLabel.value} overview`;
});

function toggleDrawer() {
  drawerModel.value = !drawerModel.value;
}

function goToEntry(entry) {
  const target = String(entry?.resolvedRoute || "").trim();
  if (!target) {
    return;
  }
  navigate({ to: target });
}
</script>

<template>
  <v-app class="shell-host bg-background" :style="workspaceThemeStyle">
    <v-app-bar border density="comfortable" elevation="0" class="shell-app-bar bg-surface">
      <v-app-bar-nav-icon
        :aria-label="isMobile ? 'Toggle navigation drawer' : 'Toggle navigation menu'"
        @click="toggleDrawer"
      />

      <v-menu location="bottom start" offset="8">
        <template #activator="{ props }">
          <v-btn v-bind="props" variant="text" class="workspace-switcher-button text-none">
            <v-avatar color="primary" size="28" class="mr-2">
              <span class="text-caption font-weight-bold">JS</span>
            </v-avatar>
            <span class="d-inline-block text-truncate" style="max-width: 180px">JSKIT Demo</span>
          </v-btn>
        </template>
        <v-list density="comfortable" min-width="260">
          <v-list-subheader>Workspaces</v-list-subheader>
          <v-list-item title="JSKIT Demo" subtitle="/demo" />
          <v-list-item title="Sandbox" subtitle="/sandbox" />
        </v-list>
      </v-menu>

      <v-toolbar-title class="text-subtitle-1 font-weight-bold ms-2">
        <span class="accent-pill" />
        {{ activeTitle }}
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

      <v-chip size="small" color="success" variant="tonal" class="mr-2">
        Live
      </v-chip>

      <v-menu location="bottom end" offset="8">
        <template #activator="{ props }">
          <v-btn v-bind="props" icon="$menuSettings" variant="text" aria-label="Open settings menu" />
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
        <template #activator="{ props }">
          <v-btn v-bind="props" variant="text" class="text-none user-menu-button" aria-label="Open user menu">
            <v-avatar color="primary" size="32" class="mr-2">
              <span class="text-caption font-weight-bold">MA</span>
            </v-avatar>
            <span class="user-menu-name d-inline-block text-truncate text-body-2 font-weight-medium">Merc</span>
          </v-btn>
        </template>
        <v-list density="comfortable" min-width="200">
          <v-list-item title="Profile" />
          <v-list-item title="Sign out" />
        </v-list>
      </v-menu>
    </v-app-bar>

    <v-navigation-drawer
      v-model="drawerModel"
      :permanent="!isMobile && drawerModel"
      :temporary="isMobile"
      :rail="!isMobile && !drawerModel"
      :expand-on-hover="!isMobile"
      :width="272"
      class="bg-surface"
      border
    >
      <v-list nav density="comfortable" class="pt-2">
        <v-list-item
          v-for="entry in drawerEntries"
          :key="entry.id"
          :title="entry.title"
          :prepend-icon="entry.icon || undefined"
          :active="isActive(entry.resolvedRoute)"
          rounded="lg"
          class="mb-1"
          @click="goToEntry(entry)"
        />
      </v-list>
    </v-navigation-drawer>

    <v-main class="shell-main">
      <v-container fluid class="shell-content">
        <Outlet />
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
.shell-host {
  min-height: 100dvh;
}

.shell-app-bar {
  border-bottom: 2px solid var(--workspace-color);
}

.workspace-switcher-button {
  max-width: 240px;
  border: 1px solid var(--workspace-color-soft);
}

.accent-pill {
  width: 18px;
  height: 6px;
  border-radius: 999px;
  background-color: var(--workspace-color);
  display: inline-block;
  margin-right: 0.5rem;
}

.user-menu-button {
  min-width: 42px;
}

.user-menu-name {
  max-width: 160px;
  letter-spacing: 0.01em;
}

.shell-main {
  background:
    linear-gradient(180deg, var(--workspace-color-soft), rgba(15, 107, 84, 0) 240px),
    rgb(var(--v-theme-background));
}

.shell-content {
  padding: 1.5rem;
}

:deep(.v-navigation-drawer .v-list-item--active) {
  background-color: var(--workspace-color-strong);
}
</style>
