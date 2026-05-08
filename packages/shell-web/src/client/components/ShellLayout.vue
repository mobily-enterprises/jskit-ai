<script setup>
import { computed, watch } from "vue";
import { useDisplay } from "vuetify";
import { useShellLayoutState } from "../composables/useShellLayoutState.js";
import ShellOutlet from "./ShellOutlet.vue";
import ShellRouteTransition from "./ShellRouteTransition.vue";

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
  }
});

const {
  drawerDefaultOpen,
  drawerOpen,
  setDrawerOpen,
  toggleDrawer,
  resolvedSurface,
  resolvedSurfaceLabel
} = useShellLayoutState(props);
const display = useDisplay();

const layoutClass = computed(() => {
  const displayName = String(display?.name?.value || "").trim().toLowerCase();
  if (displayName === "xs" || displayName === "sm") {
    return "compact";
  }
  if (displayName === "md") {
    return "medium";
  }
  return "expanded";
});
const isCompactLayout = computed(() => layoutClass.value === "compact");

watch(
  isCompactLayout,
  (compact) => {
    setDrawerOpen(compact ? false : drawerDefaultOpen.value);
  },
  { immediate: true }
);
</script>

<template>
  <v-app-bar border density="comfortable" elevation="0" class="bg-surface">
    <v-app-bar-nav-icon aria-label="Toggle navigation menu" @click="toggleDrawer" />

    <slot name="top-left" :surface="resolvedSurface">
      <div class="d-flex align-center ga-2">
        <v-chip color="primary" size="small" label>{{ resolvedSurfaceLabel }}</v-chip>
        <ShellOutlet target="shell-layout:top-left" />
      </div>
    </slot>

    <v-spacer />

    <slot name="top-right" :surface="resolvedSurface">
      <div class="d-flex align-center ga-2">
        <ShellOutlet target="shell-layout:top-right" />
      </div>
    </slot>
  </v-app-bar>

  <v-navigation-drawer
    v-model="drawerOpen"
    border
    class="bg-surface"
    :temporary="isCompactLayout"
    :permanent="!isCompactLayout"
    :width="248"
  >
    <slot name="menu" :surface="resolvedSurface">
      <v-list nav density="comfortable" class="pt-2">
        <v-list-subheader class="text-uppercase text-caption">{{ resolvedSurfaceLabel }}</v-list-subheader>
        <ShellOutlet
          target="shell-layout:primary-menu"
          default
        />
        <v-divider class="my-2" />
        <ShellOutlet target="shell-layout:secondary-menu" />
      </v-list>
    </slot>
  </v-navigation-drawer>

  <v-main class="bg-background">
    <v-container fluid class="shell-layout__content">
      <h1 v-if="title" class="shell-layout__title text-h5">{{ title }}</h1>
      <p v-if="subtitle" class="shell-layout__subtitle text-body-2 text-medium-emphasis">{{ subtitle }}</p>
      <ShellRouteTransition>
        <slot />
      </ShellRouteTransition>
    </v-container>
  </v-main>

  <v-bottom-navigation
    v-if="isCompactLayout"
    class="shell-layout__bottom-nav"
    bg-color="surface"
    color="primary"
    density="comfortable"
    grow
    mandatory
  >
    <ShellOutlet
      target="shell-layout:primary-bottom-nav"
      default
    />
  </v-bottom-navigation>
</template>

<style scoped>
.shell-layout__content {
  padding: 0.75rem 1rem calc(1rem + env(safe-area-inset-bottom, 0px));
}

.shell-layout__title {
  margin-bottom: 0.25rem;
}

.shell-layout__subtitle {
  margin-bottom: 0.75rem;
}

.shell-layout__bottom-nav {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
</style>
