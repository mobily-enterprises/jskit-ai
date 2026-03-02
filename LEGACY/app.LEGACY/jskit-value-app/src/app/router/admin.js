import AdminShell from "../shells/admin/AdminShell.vue";
import { createSurfaceRouter } from "./factory.js";
import { composeSurfaceRouteFragments, composeSurfaceRouterOptions } from "../../framework/composeRouter.js";
import { composeGuardPolicies } from "../../framework/composeGuards.js";

export function createAdminRouter({ authStore, workspaceStore }) {
  const surfaceOptions = composeSurfaceRouterOptions("admin");
  const routeFragments = composeSurfaceRouteFragments("admin");
  const guardPolicies = composeGuardPolicies();

  return createSurfaceRouter({
    authStore,
    workspaceStore,
    surface: "admin",
    shellComponent: AdminShell,
    routeFragments,
    guardPolicies,
    ...surfaceOptions
  });
}
