import AppShell from "../shells/app/AppShell.vue";
import { createSurfaceRouter } from "./factory.js";
import { composeSurfaceRouteFragments, composeSurfaceRouterOptions } from "../../framework/composeRouter.js";
import { composeGuardPolicies } from "../../framework/composeGuards.js";

export function createAppRouter({ authStore, workspaceStore }) {
  const surfaceOptions = composeSurfaceRouterOptions("app");
  const routeFragments = composeSurfaceRouteFragments("app");
  const guardPolicies = composeGuardPolicies();

  return createSurfaceRouter({
    authStore,
    workspaceStore,
    surface: "app",
    shellComponent: AppShell,
    routeFragments,
    guardPolicies,
    ...surfaceOptions
  });
}
