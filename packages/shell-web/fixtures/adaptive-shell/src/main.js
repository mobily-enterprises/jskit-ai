import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import { createVuetify } from "vuetify";
import * as vuetifyComponents from "vuetify/components";
import * as vuetifyDirectives from "vuetify/directives";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";
import "vuetify/styles";
import App from "./App.vue";
import ScreenPage from "./ScreenPage.vue";
import ShellMenuLinkItem from "@jskit-ai/shell-web/client/components/ShellMenuLinkItem";
import ShellSurfaceAwareMenuLinkItem from "@jskit-ai/shell-web/client/components/ShellSurfaceAwareMenuLinkItem";
import ShellTabLinkItem from "@jskit-ai/shell-web/client/components/ShellTabLinkItem";
import { useShellLayoutStore } from "../../../src/client/stores/useShellLayoutStore.js";
import { createWebPlacementRuntime } from "../../../src/client/placement/runtime.js";

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
    createSurfacePlacement(surface, 40, "Bookings", "/bookings"),
    createSurfacePlacement(surface, 50, "Rostering", "/rostering")
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

const placementRuntime = createWebPlacementRuntime({ components: COMPONENTS });
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

const routes = [
  { path: "/", redirect: "/home" },
  { path: "/home/settings", redirect: "/home/settings/general" },
  { path: "/home/settings/general", component: ScreenPage, meta: { title: "General settings" } },
  { path: "/home/:section?", component: ScreenPage, meta: { title: "Home surface" } },
  { path: "/w/:workspaceSlug/admin/:section?", component: ScreenPage, meta: { title: "Admin surface" } },
  { path: "/help", component: ScreenPage, meta: { title: "Help and support" } }
];
const router = createRouter({ history: createWebHistory(), routes });
const pinia = createPinia();
const vuetify = createVuetify({
  components: vuetifyComponents,
  directives: vuetifyDirectives,
  icons: {
    defaultSet: "mdi",
    aliases,
    sets: { mdi }
  },
  theme: {
    defaultTheme: "home-light",
    themes: {
      "home-light": {
        dark: false,
        colors: {
          background: "#F4F7F5",
          surface: "#FFFFFF",
          "on-surface": "#34413F",
          "surface-variant": "#E2E8E5",
          "on-surface-variant": "#52605F",
          primary: "#006C51"
        }
      },
      "admin-light": {
        dark: false,
        colors: {
          background: "#F5F6F4",
          surface: "#FFFFFF",
          "on-surface": "#34413F",
          "surface-variant": "#424242",
          "on-surface-variant": "#52605F",
          primary: "#006C51"
        }
      },
      "home-dark": {
        dark: true,
        colors: {
          background: "#101513",
          surface: "#18201D",
          "on-surface": "#E1E9E5",
          "surface-variant": "#2B3632",
          "on-surface-variant": "#BEC9C4",
          primary: "#67DBB7"
        }
      },
      "admin-dark": {
        dark: true,
        colors: {
          background: "#111412",
          surface: "#1A201D",
          "on-surface": "#E2E8E4",
          "surface-variant": "#333936",
          "on-surface-variant": "#606864",
          primary: "#67DBB7"
        }
      }
    }
  }
});

const app = createApp(App);
app.use(pinia);
app.use(router);
app.use(vuetify);
app.provide("jskit.shell-web.runtime.web-placement.client", placementRuntime);
app.provide("jskit.shell-web.runtime.web-refresh.client", {
  async refresh() {
    await fetch("/api/bootstrap?reason=pull-to-refresh");
  }
});
useShellLayoutStore(pinia).setDrawerDefaultOpen(true);
await router.isReady();
app.mount("#app");
