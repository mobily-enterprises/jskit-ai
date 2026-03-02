import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router/auto";
import { routes } from "vue-router/auto-routes";
import "vuetify/styles";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { aliases as mdiAliases, mdi } from "vuetify/iconsets/mdi-svg";
import App from "./App.vue";
import NotFoundView from "./views/NotFound.vue";
import { clientModules } from "virtual:jskit-client-modules";
import {
  collectClientModuleRoutes,
  createSurfaceRuntime,
  filterRoutesBySurface
} from "@jskit-ai/framework-core/surface/runtime";
import { SURFACE_DEFINITIONS, SURFACE_IDS, SURFACE_MODE_ALL } from "../config/surfaces.js";

const surfaceRuntime = createSurfaceRuntime({
  allMode: SURFACE_MODE_ALL,
  surfaceIds: SURFACE_IDS,
  surfaces: SURFACE_DEFINITIONS,
  defaultSurfaceId: "app"
});

const appViewModules = import.meta.glob("./views/**/*.vue");

function resolveViewModuleComponent(modulePayload, componentPath) {
  if (!modulePayload || typeof modulePayload !== "object" || !modulePayload.default) {
    throw new Error(`Route view module did not export default component: ${componentPath}`);
  }
  return modulePayload.default;
}

function resolveModuleRouteComponent(route, { packageId } = {}) {
  const componentPath = String(route?.componentPath || "").trim();
  if (!componentPath) {
    return route?.component;
  }

  if (!componentPath.startsWith("/src/")) {
    throw new Error(
      `Package ${packageId || "<unknown>"} route "${String(route?.id || "").trim()}" has invalid componentPath "${componentPath}".`
    );
  }

  const localViewPath = `.${componentPath.slice("/src".length)}`;
  const loader = appViewModules[localViewPath];
  if (typeof loader !== "function") {
    throw new Error(
      `Package ${packageId || "<unknown>"} route "${String(route?.id || "").trim()}" references missing app view "${componentPath}".`
    );
  }

  return async () => {
    const modulePayload = await loader();
    return resolveViewModuleComponent(modulePayload, componentPath);
  };
}

const surfaceMode = surfaceRuntime.normalizeSurfaceMode(import.meta.env.VITE_SURFACE);
const moduleRoutes = collectClientModuleRoutes({
  clientModules,
  resolveComponent: resolveModuleRouteComponent
});
const fallbackRoute = Object.freeze({
  path: "/:pathMatch(.*)*",
  name: "not-found",
  component: NotFoundView,
  meta: {
    jskit: {
      scope: "global"
    }
  }
});
const activeRoutes = filterRoutesBySurface([...routes, ...moduleRoutes, fallbackRoute], {
  surfaceRuntime,
  surfaceMode
});

const router = createRouter({
  history: createWebHistory(),
  routes: activeRoutes
});

const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: "light",
    themes: {
      light: {
        colors: {
          primary: "#0f6b54",
          secondary: "#3f5150",
          background: "#eef3ee",
          surface: "#f7fbf6",
          "surface-variant": "#dfe8df",
          "on-surface-variant": "#3b4c44",
          error: "#9f1d1d"
        }
      },
      dark: {
        colors: {
          primary: "#6fd0b5",
          secondary: "#9db2af",
          background: "#0f1715",
          surface: "#16211e",
          "surface-variant": "#253430",
          "on-surface-variant": "#c5d6d2",
          error: "#ffb4ab"
        }
      }
    }
  },
  icons: {
    defaultSet: "mdi",
    aliases: mdiAliases,
    sets: { mdi }
  }
});

createApp(App).use(router).use(vuetify).mount("#app");
