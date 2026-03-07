<script setup>
import { computed } from "vue";
import { useSurfaceShell } from "./useSurfaceShell.js";

const props = defineProps({
  surfaceLabel: {
    type: String,
    default: "Surface"
  },
  title: {
    type: String,
    default: "Surface is ready."
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

const { drawerOpen, resolvedTopLeftActions, resolvedTopRightActions, resolvedMenuItems, toggleDrawer } = useSurfaceShell({
  topLeftActions: computed(() => props.topLeftActions),
  topRightActions: computed(() => props.topRightActions),
  menuItems: computed(() => props.menuItems)
});
</script>

<template>
  <v-layout class="surface-shell border rounded-lg overflow-hidden">
    <v-app-bar border density="comfortable" elevation="0" class="bg-surface">
      <v-app-bar-nav-icon aria-label="Toggle navigation menu" @click="toggleDrawer" />

      <slot name="top-left" :actions="resolvedTopLeftActions">
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
        </div>
      </slot>

      <v-spacer />

      <slot name="top-right" :actions="resolvedTopRightActions">
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
        </div>
      </slot>
    </v-app-bar>

    <v-navigation-drawer v-model="drawerOpen" border class="bg-surface" :width="248">
      <slot name="menu" :items="resolvedMenuItems">
        <v-list nav density="comfortable" class="pt-2">
          <v-list-subheader class="text-uppercase text-caption">{{ surfaceLabel }}</v-list-subheader>
          <v-list-item
            v-for="item in resolvedMenuItems"
            :key="`menu-${item.label}`"
            :title="item.label"
            :to="item.to"
            :prepend-icon="item.icon"
            rounded="lg"
            class="mb-1"
          />
        </v-list>
      </slot>
    </v-navigation-drawer>

    <v-main class="bg-background">
      <v-container fluid class="pa-4">
        <v-chip color="primary" size="small" label class="mb-3">{{ surfaceLabel }}</v-chip>
        <h1 class="text-h5 mb-2">{{ title }}</h1>
        <p class="text-body-2 text-medium-emphasis mb-4">{{ subtitle }}</p>
        <slot />
      </v-container>
    </v-main>
  </v-layout>
</template>

<style scoped>
.surface-shell {
  min-height: 72vh;
}
</style>
