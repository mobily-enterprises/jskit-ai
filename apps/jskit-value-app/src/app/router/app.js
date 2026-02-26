import AppShell from "../shells/app/AppShell.vue";
import { createSurfaceRouter } from "./factory.js";
import { composeSurfaceRouterOptions } from "../../framework/composeRouter.js";

export function createAppRouter({ authStore, workspaceStore }) {
  const surfaceOptions = composeSurfaceRouterOptions("app");

  return createSurfaceRouter({
    authStore,
    workspaceStore,
    surface: "app",
    shellComponent: AppShell,
    ...surfaceOptions
  });
}
