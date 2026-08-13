<script setup>
import { computed, watchEffect } from "vue";
import { RouterView, useRoute } from "vue-router";
import { useTheme } from "vuetify";
import ShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";

const route = useRoute();
const theme = useTheme();
const surface = computed(() => route.path.startsWith("/w/") ? "admin" : "home");
const surfaceLabel = computed(() => surface.value === "admin" ? "Admin" : "Home");
const themeMode = computed(() => route.query.theme === "dark" ? "dark" : "light");

watchEffect(function applyFixtureTheme() {
  const themeName = `${surface.value}-${themeMode.value}`;
  theme.change(themeName);
  document.body.dataset.surface = surface.value;
  document.body.dataset.theme = themeMode.value;
});
</script>

<template>
  <v-app>
    <ShellLayout :surface="surface" :surface-label="surfaceLabel">
      <RouterView />
    </ShellLayout>
  </v-app>
</template>
