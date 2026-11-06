import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import { createVuetify } from "vuetify";
import * as vuetifyComponents from "vuetify/components";
import * as vuetifyDirectives from "vuetify/directives";
import "vuetify/styles";
import "@jskit-ai/material-web/client/material.css";
import { materialThemes, createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { shellScrollBehavior } from "@jskit-ai/kernel/client";
import App from "./App.vue";
import { adminTheme, theme } from "./theme/index.js";
import RecordListPage from "./RecordListPage.vue";
import RecordPage from "./RecordPage.vue";
import ScreenPage from "./ScreenPage.vue";
import SettingsPage from "./SettingsPage.vue";
import ShellMenuLinkItem from "@jskit-ai/shell-web/client/components/ShellMenuLinkItem";
import ShellSurfaceAwareMenuLinkItem from "@jskit-ai/shell-web/client/components/ShellSurfaceAwareMenuLinkItem";
import ShellTabLinkItem from "@jskit-ai/shell-web/client/components/ShellTabLinkItem";
import { useShellLayoutStore } from "../../../src/client/stores/useShellLayoutStore.js";
import { createWebPlacementRuntime } from "../../../src/client/placement/runtime.js";
import { SHELL_WEB_PLACEMENT_RUNTIME_KEY } from "../../../src/client/placement/inject.js";
import { SHELL_WEB_ERROR_RUNTIME_KEY } from "../../../src/client/error/inject.js";
import { SHELL_WEB_REFRESH_RUNTIME_KEY } from "../../../src/client/runtime/refreshRuntime.js";
import {
  SHELL_NAVIGATION_RUNTIME_KEY,
  createShellNavigationRuntime
} from "../../../src/client/navigation/shellNavigationRuntime.js";
import { createErrorRuntime } from "../../../src/client/error/runtime.js";
import { createDefaultMaterialErrorPresenters } from "../../../src/client/error/presenters.js";
import { createErrorPresentationStore } from "../../../src/client/error/store.js";
import { useShellErrorPresentationStore } from "../../../src/client/stores/useShellErrorPresentationStore.js";
import { silentLogger } from "@jskit-ai/kernel/shared/support/silentLogger";

const COMPONENTS = new Map([
  ["fixture.menu-link", ShellMenuLinkItem],
  ["fixture.surface-menu-link", ShellSurfaceAwareMenuLinkItem],
  ["fixture.tab-link", ShellTabLinkItem]
]);

function createSurfacePlacement(surface, order, label, suffix) {
  return {
    id: `fixture.${surface}.${label.toLowerCase()}`,
    target: "shell.primary-nav",
    kind: "link",
    surfaces: [surface],
    order,
    props: {
      label,
      surface,
      scopedSuffix: suffix,
      unscopedSuffix: suffix,
      exact: suffix === "/"
    }
  };
}

function createSurfacePlacements(surface) {
  return [
    createSurfacePlacement(surface, 10, "Home", "/"),
    surface === "home"
      ? createSurfacePlacement(surface, 20, "Settings", "/settings")
      : createSurfacePlacement(surface, 20, "Assistant", "/assistant"),
    createSurfacePlacement(surface, 30, "Contacts", "/contacts"),
    surface === "home"
      ? createSurfacePlacement(surface, 40, "Suppliers", "/suppliers")
      : createSurfacePlacement(surface, 40, "Bookings", "/bookings"),
    surface === "home"
      ? createSurfacePlacement(surface, 50, "Bookings", "/bookings")
      : createSurfacePlacement(surface, 50, "Rostering", "/rostering")
  ];
}

const placements = [
  ...createSurfacePlacements("home"),
  ...createSurfacePlacements("admin"),
  {
    id: "fixture.help",
    target: "shell.secondary-nav",
    kind: "link",
    componentToken: "fixture.menu-link",
    surfaces: ["*"],
    order: 100,
    props: {
      label: "Help and support",
      to: "/help"
    }
  }
];

const menuRenderers = Object.freeze({ link: "fixture.surface-menu-link" });
const tabRenderers = Object.freeze({ link: "fixture.tab-link" });
const placementTopology = [
  {
    id: "shell.primary-nav",
    surfaces: ["*"],
    default: true,
    variants: {
      compact: { outlet: "shell-layout:primary-bottom-nav", renderers: tabRenderers },
      medium: { outlet: "shell-layout:primary-menu", renderers: menuRenderers },
      expanded: { outlet: "shell-layout:primary-menu", renderers: menuRenderers }
    }
  },
  {
    id: "shell.secondary-nav",
    surfaces: ["*"],
    variants: {
      compact: { outlet: "shell-layout:secondary-menu", renderers: menuRenderers },
      medium: { outlet: "shell-layout:secondary-menu", renderers: menuRenderers },
      expanded: { outlet: "shell-layout:secondary-menu", renderers: menuRenderers }
    }
  }
];

const placementRuntime = createWebPlacementRuntime({ components: COMPONENTS, logger: silentLogger });
placementRuntime.replacePlacements(placements);
placementRuntime.replacePlacementTopology(placementTopology);
placementRuntime.setContext({
  surfaceConfig: {
    tenancyMode: "path",
    defaultSurfaceId: "home",
    enabledSurfaceIds: ["home", "admin"],
    surfacesById: {
      home: { id: "home", routeBase: "/home", enabled: true },
      admin: { id: "admin", routeBase: "/w/:workspaceSlug/admin", enabled: true }
    }
  }
});

// A record a test has marked unavailable (deleted, or no longer the person's to see) redirects, as a guard does.
function refuseBlockedRecord(to) {
  return (window.__fixtureBlockedRecords || []).includes(String(to.params.id)) ? "/sign-in" : true;
}

const routes = [
  { path: "/", redirect: "/home" },
  {
    path: "/home/settings",
    component: SettingsPage,
    meta: { jskit: { title: "Settings" } },
    children: [
      { path: "", component: ScreenPage, meta: { title: "Settings", empty: true } },
      {
        path: "general",
        component: ScreenPage,
        meta: { title: "General settings", jskit: { title: "General settings", parent: "/settings" } }
      }
    ]
  },
  { path: "/home/contacts", component: RecordListPage, meta: { kind: "contacts", jskit: { title: "Contacts" } } },
  {
    path: "/home/contacts/:id",
    component: RecordPage,
    beforeEnter: refuseBlockedRecord,
    meta: { kind: "contacts", jskit: { parent: "/contacts" } }
  },
  { path: "/home/suppliers", component: RecordListPage, meta: { kind: "suppliers", jskit: { title: "Suppliers" } } },
  {
    path: "/home/suppliers/:id",
    component: RecordPage,
    beforeEnter: refuseBlockedRecord,
    meta: { kind: "suppliers", jskit: { parent: "/suppliers" } }
  },
  { path: "/home/:section?", component: ScreenPage, meta: { title: "Home surface" } },
  { path: "/w/:workspaceSlug/admin/:section?", component: ScreenPage, meta: { title: "Admin surface" } },
  { path: "/help", component: ScreenPage, meta: { title: "Help and support" } },
  { path: "/sign-in", component: ScreenPage, meta: { title: "Sign in", bare: true } }
];
const router = createRouter({ history: createWebHistory(), routes, scrollBehavior: shellScrollBehavior });
const navigationRuntime = createShellNavigationRuntime({ router });
navigationRuntime.install();
const pinia = createPinia();
const material = createMaterialVuetifyOptions(theme);
const adminThemes = materialThemes(adminTheme.seed);
const vuetify = createVuetify({
  ...material,
  components: vuetifyComponents,
  directives: vuetifyDirectives,
  theme: {
    defaultTheme: "home-light",
    themes: {
      "home-light": material.theme.themes.light,
      "home-dark": material.theme.themes.dark,
      "admin-light": adminThemes.light,
      "admin-dark": adminThemes.dark
    }
  }
});

const app = createApp(App);
app.use(pinia);
app.use(router);
app.use(vuetify);
app.provide(SHELL_WEB_PLACEMENT_RUNTIME_KEY, placementRuntime);
app.provide(SHELL_NAVIGATION_RUNTIME_KEY, navigationRuntime);
const errorStore = createErrorPresentationStore();
const errorRuntime = createErrorRuntime({
  presenters: createDefaultMaterialErrorPresenters({ store: errorStore }),
  defaultPresenterId: "material.snackbar",
  logger: silentLogger
});
useShellErrorPresentationStore(pinia).attachRuntimeStore(errorStore);
app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, errorRuntime);
window.__shellFixtureReportBanner = (message) => errorRuntime.report({
  source: "shell-web.fixture",
  message,
  severity: "error",
  channel: "banner"
});
app.provide(SHELL_WEB_REFRESH_RUNTIME_KEY, {
  async refresh() {
    await fetch("/api/bootstrap?reason=pull-to-refresh");
  }
});
useShellLayoutStore(pinia).setDrawerDefaultOpen(true);
await router.isReady();
app.mount("#app");
