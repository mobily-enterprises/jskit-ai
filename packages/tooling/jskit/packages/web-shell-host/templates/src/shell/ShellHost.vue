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
  <v-app class="shell-host bg-background">
    <v-app-bar border density="comfortable" elevation="0" class="shell-app-bar bg-surface">
      <v-app-bar-nav-icon
        :aria-label="isMobile ? 'Toggle navigation drawer' : 'Toggle navigation menu'"
        @click="toggleDrawer"
      />

      <v-toolbar-title class="text-subtitle-1 font-weight-bold">
        {{ surfaceLabel }} surface
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
          <v-btn v-bind="props" variant="text" class="text-none" aria-label="Open user menu">
            User
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

.shell-main {
  background: transparent;
}

.shell-content {
  padding: 1.5rem;
}
</style>
