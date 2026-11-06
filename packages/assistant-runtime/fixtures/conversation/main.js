import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import "vuetify/styles";
import "@jskit-ai/material-web/client/material.css";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import App from "./App.vue";
import { createWebPlacementRuntime } from "../../../shell-web/src/client/placement/runtime.js";
import { silentLogger } from "@jskit-ai/kernel/shared/support/silentLogger";

globalThis.__JSKIT_CLIENT_APP_CONFIG__ = {
  surfaceDefinitions: { admin: { requiresWorkspace: true }, console: { requiresWorkspace: false } },
  assistantSurfaces: {
    admin: { settingsSurfaceId: "admin", configScope: "workspace" },
    console: { settingsSurfaceId: "console", configScope: "global" }
  }
};
const router = createRouter({ history: createWebHistory(), routes: [{ path: "/:pathMatch(.*)*", component: App }] });
const app = createApp(App);
const placement = createWebPlacementRuntime({ components: new Map(), logger: silentLogger });
placement.setContext({ user: { id: "1" }, surfaceConfig: {
  defaultSurfaceId: "admin",
  surfacesById: { admin: { id: "admin", routeBase: "/", requiresWorkspace: false } }
} });
app.provide("jskit.shell-web.runtime.web-placement.client", placement);
app.provide("jskit.workspaces.web.scope-support", { readRouteScope: ({ route }) => ({ workspaceSlug: route.query.workspace || "alpha" }) });
app.use(router).use(VueQueryPlugin, { queryClientConfig: { defaultOptions: { queries: { retry: false } } } });
app.use(createVuetify({ components, directives, ...createMaterialVuetifyOptions() }));
await router.isReady();
app.mount("#app");
