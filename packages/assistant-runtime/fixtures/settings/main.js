import { createApp, h } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory, RouterView } from "vue-router";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import "vuetify/styles";
import "@jskit-ai/material-web/client/material.css";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { silentLogger } from "@jskit-ai/kernel/shared/support/silentLogger";
import ShellLayout from "@jskit-ai/shell-web/client/components/ShellLayout";
import { createWebPlacementRuntime } from "../../../shell-web/src/client/placement/runtime.js";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "../../../shell-web/src/client/placement/inject.js";
import { SHELL_WEB_ERROR_RUNTIME_KEY } from "../../../shell-web/src/client/error/inject.js";
import {
  SHELL_NAVIGATION_RUNTIME_KEY,
  createShellNavigationRuntime
} from "../../../shell-web/src/client/navigation/shellNavigationRuntime.js";
import AssistantSettingsClientElement from "../../src/client/components/AssistantSettingsClientElement.vue";

// The assistant settings pane in the real shell, as a settings page renders it: the shell's top app bar carries the
// pane's title and its Save. The console's settings are global; the admin surface's belong to a workspace, which the
// address names (?workspace=alpha) or doesn't. The settings API is the test's (Playwright routes /api/**).
globalThis.__JSKIT_CLIENT_APP_CONFIG__ = {
  surfaceDefinitions: {
    console: { id: "console", requiresWorkspace: false },
    admin: { id: "admin", requiresWorkspace: true }
  },
  assistantSurfaces: {
    console: { settingsSurfaceId: "console", configScope: "global" },
    admin: { settingsSurfaceId: "admin", configScope: "workspace" }
  }
};

window.settingsFixture = { reports: [] };

const placementRuntime = createWebPlacementRuntime({ components: new Map(), logger: silentLogger });
placementRuntime.setContext({
  user: { id: "1" },
  surfaceConfig: {
    defaultSurfaceId: "app",
    enabledSurfaceIds: ["app"],
    surfacesById: { app: { id: "app", routeBase: "/", pagesRoot: "", enabled: true, requiresWorkspace: false } }
  }
});
const errorRuntime = {
  report(event) {
    window.settingsFixture.reports.push({ source: event.source, message: event.message });
    return { skipped: false };
  },
  dismiss: () => 0
};

function settingsPage(targetSurfaceId) {
  return { render: () => h(AssistantSettingsClientElement, { targetSurfaceId }) };
}

const routes = [
  { path: "/settings/console", component: settingsPage("console") },
  { path: "/settings/admin", component: settingsPage("admin") }
];
const router = createRouter({ history: createWebHistory(), routes });
const navigationRuntime = createShellNavigationRuntime({ router });
navigationRuntime.install();

const app = createApp({
  render: () => h(components.VApp, null, {
    default: () => h(ShellLayout, { surface: "app", surfaceLabel: "Fixture" }, { default: () => h(RouterView) })
  })
});
app.use(createPinia());
app.use(router);
app.use(VueQueryPlugin, { queryClientConfig: { defaultOptions: { queries: { retry: false } } } });
app.use(createVuetify({ components, directives, ...createMaterialVuetifyOptions() }));
app.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, placementRuntime);
app.provide(SHELL_NAVIGATION_RUNTIME_KEY, navigationRuntime);
app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, errorRuntime);
app.provide("jskit.workspaces.web.scope-support", {
  available: true,
  readRouteScope: ({ route }) => ({ workspaceSlug: String(route.query.workspace || "") })
});
await router.isReady();
app.mount("#app");
