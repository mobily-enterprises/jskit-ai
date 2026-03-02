import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router/auto";
import { routes } from "vue-router/auto-routes";
import App from "./App.vue";
import { createSurfaceRuntime, filterRoutesBySurface } from "@jskit-ai/framework-core/surface/runtime";
import { SURFACE_DEFINITIONS, SURFACE_IDS, SURFACE_MODE_ALL } from "../config/surfaces.js";

const surfaceRuntime = createSurfaceRuntime({
  allMode: SURFACE_MODE_ALL,
  surfaceIds: SURFACE_IDS,
  surfaces: SURFACE_DEFINITIONS,
  defaultSurfaceId: "app"
});

const surfaceMode = surfaceRuntime.normalizeSurfaceMode(import.meta.env.VITE_SURFACE);
const activeRoutes = filterRoutesBySurface(routes, {
  surfaceRuntime,
  surfaceMode
});

const router = createRouter({
  history: createWebHistory(),
  routes: activeRoutes
});

createApp(App).use(router).mount("#app");
