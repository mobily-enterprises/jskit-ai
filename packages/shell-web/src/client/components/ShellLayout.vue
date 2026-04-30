<script setup>
import { useShellLayoutState } from "../composables/useShellLayoutState.js";
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
  }
});

const { drawerOpen, toggleDrawer, resolvedSurface, resolvedSurfaceLabel } = useShellLayoutState(props);
</script>

<template>
  <v-layout class="shell-layout border rounded-lg overflow-hidden">
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

    <v-navigation-drawer v-model="drawerOpen" border class="bg-surface" :width="248">
      <slot name="menu" :surface="resolvedSurface">
        <v-list nav density="comfortable" class="pt-2">
          <v-list-subheader class="text-uppercase text-caption">{{ resolvedSurfaceLabel }}</v-list-subheader>
          <ShellOutlet
            target="shell-layout:primary-menu"
            default
            default-link-component-token="local.main.ui.surface-aware-menu-link-item"
          />
          <v-divider class="my-2" />
          <ShellOutlet
            target="shell-layout:secondary-menu"
            default-link-component-token="local.main.ui.surface-aware-menu-link-item"
          />
        </v-list>
      </slot>
    </v-navigation-drawer>

    <v-main class="bg-background">
      <v-container fluid class="shell-layout__content">
        <h1 v-if="title" class="shell-layout__title text-h5">{{ title }}</h1>
        <p v-if="subtitle" class="shell-layout__subtitle text-body-2 text-medium-emphasis">{{ subtitle }}</p>
        <slot />
      </v-container>
    </v-main>
  </v-layout>
</template>

<style scoped>
.shell-layout {
  min-height: 72vh;
}

.shell-layout__content {
  padding: 0.75rem 1rem 1rem;
}

.shell-layout__title {
  margin-bottom: 0.25rem;
}

.shell-layout__subtitle {
  margin-bottom: 0.75rem;
}
</style>
