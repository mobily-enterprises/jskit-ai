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
import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import { buildSurfaceAwareRoutes, createShellBeforeEachGuard } from "@jskit-ai/kernel/client";
import {
  SURFACE_DEFAULT_ID,
  SURFACE_DEFINITIONS,
  SURFACE_MODE_ALL,
  WEB_ROOT_ALLOWED
} from "../config/surfaces.js";

const surfaceRuntime = createSurfaceRuntime({
  allMode: SURFACE_MODE_ALL,
  surfaces: SURFACE_DEFINITIONS,
  defaultSurfaceId: SURFACE_DEFAULT_ID
});

const surfaceMode = surfaceRuntime.normalizeSurfaceMode(import.meta.env.VITE_SURFACE);
const activeRoutes = buildSurfaceAwareRoutes({
  routes,
  notFoundComponent: NotFoundView,
  surfaceRuntime,
  surfaceMode
});

const router = createRouter({
  history: createWebHistory(),
  routes: activeRoutes
});

router.beforeEach(
  createShellBeforeEachGuard({
    surfaceRuntime,
    surfaceDefinitions: SURFACE_DEFINITIONS,
    defaultSurfaceId: SURFACE_DEFAULT_ID,
    webRootAllowed: WEB_ROOT_ALLOWED
  })
);

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
