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
import ButtonsPage from "./ButtonsPage.vue";
import { adminTheme, theme } from "./theme/index.js";
import RecordListPage from "./RecordListPage.vue";
import RecordPage from "./RecordPage.vue";
import ScreenPage from "./ScreenPage.vue";
import StudioPage from "./StudioPage.vue";
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

// Main navigation as literal data, one placement per destination, as jskit check reads it.
const placements = [
  {
    id: "fixture.home.home",
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["home"],
    order: 10,
    props: { label: "Home", surface: "home", scopedSuffix: "/", unscopedSuffix: "/", exact: true }
  },
  {
    id: "fixture.home.settings",
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["home"],
    order: 20,
    props: { label: "Settings", surface: "home", scopedSuffix: "/settings", unscopedSuffix: "/settings" }
  },
  {
    id: "fixture.home.contacts",
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["home"],
    order: 30,
    props: { label: "Contacts", surface: "home", scopedSuffix: "/contacts", unscopedSuffix: "/contacts" }
  },
  {
    id: "fixture.home.suppliers",
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["home"],
    order: 40,
    props: { label: "Suppliers", surface: "home", scopedSuffix: "/suppliers", unscopedSuffix: "/suppliers" }
  },
  {
    id: "fixture.home.bookings",
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["home"],
    order: 50,
    props: { label: "Bookings", surface: "home", scopedSuffix: "/bookings", unscopedSuffix: "/bookings" }
  },
  {
    id: "fixture.admin.home",
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["admin"],
    order: 10,
    props: { label: "Home", surface: "admin", scopedSuffix: "/", unscopedSuffix: "/", exact: true }
  },
  {
    id: "fixture.admin.assistant",
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["admin"],
    order: 20,
    props: { label: "Assistant", surface: "admin", scopedSuffix: "/assistant", unscopedSuffix: "/assistant" }
  },
  {
    id: "fixture.admin.contacts",
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["admin"],
    order: 30,
    props: { label: "Contacts", surface: "admin", scopedSuffix: "/contacts", unscopedSuffix: "/contacts" }
  },
  {
    id: "fixture.admin.bookings",
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["admin"],
    order: 40,
    props: { label: "Bookings", surface: "admin", scopedSuffix: "/bookings", unscopedSuffix: "/bookings" }
  },
  {
    id: "fixture.admin.rostering",
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["admin"],
    order: 50,
    props: { label: "Rostering", surface: "admin", scopedSuffix: "/rostering", unscopedSuffix: "/rostering" }
  },
  {
    id: "fixture.help",
    target: "shell.secondary-nav",
    kind: "link",
    componentToken: "fixture.menu-link",
    // Only home has a secondary destination, so on a phone admin's are all in the navigation bar and it has no drawer.
    surfaces: ["home"],
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
    enabledSurfaceIds: ["home", "admin", "account"],
    surfacesById: {
      home: { id: "home", routeBase: "/home", enabled: true },
      admin: { id: "admin", routeBase: "/w/:workspaceSlug/admin", enabled: true },
      // A surface whose shell has no navigation, as an account page's.
      account: { id: "account", routeBase: "/account", enabled: true }
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
  {
    path: "/home/contacts/:id/edit",
    component: ScreenPage,
    meta: { title: "Edit contact", jskit: { title: "Edit contact", parent: "/contacts/:id" } }
  },
  { path: "/home/suppliers", component: RecordListPage, meta: { kind: "suppliers", jskit: { title: "Suppliers" } } },
  {
    path: "/home/suppliers/:id",
    component: RecordPage,
    beforeEnter: refuseBlockedRecord,
    meta: { kind: "suppliers", jskit: { parent: "/suppliers" } }
  },
  { path: "/home/buttons", component: ButtonsPage, meta: { jskit: { title: "Buttons" } } },
  // A layout that draws its own top app bar from the shell's pieces.
  { path: "/home/studio", component: StudioPage, meta: { ownBar: true, jskit: { title: "Studio" } } },
  { path: "/home/studio/:id", component: StudioPage, meta: { ownBar: true, jskit: { parent: "/studio" } } },
  { path: "/home/:section?", component: ScreenPage, meta: { title: "Home surface" } },
  { path: "/w/:workspaceSlug/admin/:section?", component: ScreenPage, meta: { title: "Admin surface" } },
  { path: "/help", component: ScreenPage, meta: { title: "Help and support" } },
  {
    path: "/account",
    component: ScreenPage,
    meta: { title: "Account", jskit: { title: "Account", parent: { surface: "home", path: "/" } } }
  },
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
