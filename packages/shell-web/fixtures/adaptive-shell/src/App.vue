<script setup>
import { computed, watchEffect } from "vue";
import { RouterView, useRoute } from "vue-router";
import { useTheme } from "vuetify";
import ShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";
import ShellErrorHost from "@jskit-ai/shell-web/client/components/ShellErrorHost";
import OwnBarLayout from "./OwnBarLayout.vue";

const route = useRoute();
const theme = useTheme();
const bare = computed(() => route.meta.bare === true);
const ownBar = computed(() => route.meta.ownBar === true);
const surface = computed(() => route.path.startsWith("/w/") ? "admin" : "home");
const surfaceLabel = computed(() => surface.value === "admin" ? "Admin" : "Home");
const themeMode = computed(() => route.query.theme === "dark" ? "dark" : "light");
const railWidth = computed(() => Number(route.query.railWidth) || undefined);
const navigationItemSpacing = computed(() => Number(route.query.navigationItemSpacing) || undefined);
const drawerWidth = computed(() => (route.query.drawerWidth === "content" ? "content" : undefined));

watchEffect(function applyFixtureTheme() {
  const themeName = `${surface.value}-${themeMode.value}`;
  theme.change(themeName);
  document.body.dataset.surface = surface.value;
  document.body.dataset.theme = themeMode.value;
});
</script>

<template>
  <v-app>
    <RouterView v-if="bare" />
    <OwnBarLayout v-else-if="ownBar">
      <RouterView />
    </OwnBarLayout>
    <ShellLayout
      v-else
      :surface="surface"
      :surface-label="surfaceLabel"
      :rail-width="railWidth"
      :navigation-item-spacing="navigationItemSpacing"
      :drawer-width="drawerWidth"
    >
      <RouterView />
    </ShellLayout>
    <ShellErrorHost />
  </v-app>
</template>
