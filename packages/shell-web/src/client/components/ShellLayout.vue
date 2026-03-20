<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";
import { useWebPlacementContext } from "../placement/inject.js";
import {
  readPlacementSurfaceConfig,
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname
} from "../placement/surfaceContext.js";
import { useShellLayout } from "./useShellLayout.js";
import ShellOutlet from "./ShellOutlet.vue";

const props = defineProps({
  surface: {
    type: String,
    default: ""
  },
  surfaceLabel: {
    type: String,
    default: ""
  },
  title: {
    type: String,
    default: ""
  },
  subtitle: {
    type: String,
    default: ""
  },
  topLeftActions: {
    type: Array,
    default: () => []
  },
  topRightActions: {
    type: Array,
    default: () => []
  },
  menuItems: {
    type: Array,
    default: () => []
  }
});

let route = null;
try {
  route = useRoute();
} catch {
  route = null;
}
const { context: placementContext } = useWebPlacementContext();

function toSurfaceLabel(surfaceId = "") {
  const normalizedSurfaceId = String(surfaceId || "").trim().toLowerCase();
  if (!normalizedSurfaceId) {
    return "Surface";
  }

  return normalizedSurfaceId
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

const resolvedSurface = computed(() => {
  const explicitSurface = normalizeSurfaceId(props.surface);
  if (explicitSurface) {
    return explicitSurface;
  }

  const pathname =
    String(route?.path || "").trim() ||
    (typeof window === "object" && window?.location?.pathname ? String(window.location.pathname).trim() : "/");
  const contextValue = placementContext?.value || null;
  const resolvedSurfaceFromPath = resolveSurfaceIdFromPlacementPathname(contextValue, pathname);
  if (resolvedSurfaceFromPath) {
    return resolvedSurfaceFromPath;
  }

  const surfaceConfig = readPlacementSurfaceConfig(contextValue);
  if (surfaceConfig.defaultSurfaceId) {
    return surfaceConfig.defaultSurfaceId;
  }

  return "surface";
});

const resolvedSurfaceLabel = computed(() => {
  const explicitLabel = String(props.surfaceLabel || "").trim();
  if (explicitLabel) {
    return explicitLabel;
  }

  const surfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(
    placementContext?.value || null,
    resolvedSurface.value
  );
  const configuredLabel = String(surfaceDefinition?.label || "").trim();
  if (configuredLabel) {
    return configuredLabel;
  }

  return toSurfaceLabel(resolvedSurface.value);
});

const { drawerOpen, resolvedTopLeftActions, resolvedTopRightActions, resolvedMenuItems, toggleDrawer } = useShellLayout({
  topLeftActions: computed(() => props.topLeftActions),
  topRightActions: computed(() => props.topRightActions),
  menuItems: computed(() => props.menuItems)
});
</script>

<template>
  <v-layout class="shell-layout border rounded-lg overflow-hidden">
    <v-app-bar border density="comfortable" elevation="0" class="bg-surface">
      <v-app-bar-nav-icon aria-label="Toggle navigation menu" @click="toggleDrawer" />

      <slot name="top-left" :actions="resolvedTopLeftActions" :surface="resolvedSurface">
        <div class="d-flex align-center ga-2">
          <v-btn
            v-for="action in resolvedTopLeftActions"
            :key="`top-left-${action.label}`"
            :to="action.to || undefined"
            :variant="action.variant"
            :color="action.color"
            size="small"
            class="text-none"
          >
            {{ action.label }}
          </v-btn>
          <v-chip color="primary" size="small" label>{{ resolvedSurfaceLabel }}</v-chip>
          <ShellOutlet host="shell-layout" position="top-left" />
        </div>
      </slot>

      <v-spacer />

      <slot name="top-right" :actions="resolvedTopRightActions" :surface="resolvedSurface">
        <div class="d-flex align-center ga-2">
          <v-btn
            v-for="action in resolvedTopRightActions"
            :key="`top-right-${action.label}`"
            :to="action.to || undefined"
            :variant="action.variant"
            :color="action.color"
            size="small"
            class="text-none"
          >
            {{ action.label }}
          </v-btn>
          <ShellOutlet host="shell-layout" position="top-right" />
        </div>
      </slot>
    </v-app-bar>

    <v-navigation-drawer v-model="drawerOpen" border class="bg-surface" :width="248">
      <slot name="menu" :items="resolvedMenuItems" :surface="resolvedSurface">
        <v-list nav density="comfortable" class="pt-2">
          <v-list-subheader class="text-uppercase text-caption">{{ resolvedSurfaceLabel }}</v-list-subheader>
          <v-list-item
            v-for="item in resolvedMenuItems"
            :key="`menu-${item.label}`"
            :title="item.label"
            :to="item.to"
            :prepend-icon="item.icon"
            rounded="lg"
            class="mb-1"
          />
          <ShellOutlet host="shell-layout" position="primary-menu" />
          <v-divider class="my-2" />
          <ShellOutlet host="shell-layout" position="secondary-menu" />
        </v-list>
      </slot>
    </v-navigation-drawer>

    <v-main class="bg-background">
      <v-container fluid class="pa-4">
        <h1 class="text-h5 mb-2">{{ title }}</h1>
        <p class="text-body-2 text-medium-emphasis mb-4">{{ subtitle }}</p>
        <slot />
      </v-container>
    </v-main>
  </v-layout>
</template>

<style scoped>
.shell-layout {
  min-height: 72vh;
}
</style>
