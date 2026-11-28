<script setup>
import { computed, watchEffect } from "vue";
import { RouterView, useRoute } from "vue-router";
import { useTheme } from "vuetify";
import ShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";
import ShellErrorHost from "@jskit-ai/shell-web/client/components/ShellErrorHost";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import OwnBarLayout from "./OwnBarLayout.vue";

const route = useRoute();
const theme = useTheme();
const { mergeContext } = useWebPlacementContext();
const bare = computed(() => route.meta.bare === true);
const ownBar = computed(() => route.meta.ownBar === true);
const surface = computed(() => {
  if (route.path.startsWith("/w/")) return "admin";
  if (route.path.startsWith("/solo")) return "solo";
  if (route.path.startsWith("/console")) return "console";
  return route.path.startsWith("/account") ? "account" : "home";
});
const surfaceLabel = computed(() => ({ admin: "Admin", account: "Account", console: "Console" })[surface.value] || "Home");

// The console's destinations depend on its session's permissions (consolePermissions), which load after the page
// opens, as an app's own session does (mobilynet's console): the context says they are pending until they arrive, or
// until the request fails, when the console has none.
async function loadConsoleSession() {
  let permissions = [];
  try {
    const response = await fetch("/api/fixture/console-session", { headers: { accept: "application/json" } });
    permissions = response.ok ? (await response.json()).permissions : [];
  } catch {
    permissions = [];
  }
  mergeContext({ consolePermissions: permissions }, "fixture.console-session");
}

if (route.path.startsWith("/console")) {
  mergeContext({ consolePermissions: [] }, "fixture.console-session", { pending: true });
  void loadConsoleSession();
}
const themeMode = computed(() => route.query.theme === "dark" ? "dark" : "light");
const railWidth = computed(() => Number(route.query.railWidth) || undefined);
const navigationItemSpacing = computed(() => Number(route.query.navigationItemSpacing) || undefined);
// ?drawerWidth=material asks for Material 3's full drawer width and a number fixes it; unset, the drawer fits its labels.
const drawerWidth = computed(() =>
  (route.query.drawerWidth === "material" ? "material" : Number(route.query.drawerWidth) || undefined)
);
// ?identity=<name> puts an identity at the top of the drawer, as a workspace switcher does.
const identity = computed(() => String(route.query.identity || ""));

watchEffect(function applyFixtureTheme() {
  const themeName = `${surface.value === "admin" ? "admin" : "home"}-${themeMode.value}`;
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
      <template v-if="identity" #top-left>
        <v-btn variant="text" class="fixture-identity text-none" prepend-icon="$work">{{ identity }}</v-btn>
      </template>
      <RouterView />
    </ShellLayout>
    <ShellErrorHost />
  </v-app>
</template>
