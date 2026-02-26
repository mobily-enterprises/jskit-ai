import AdminShell from "../shells/admin/AdminShell.vue";
import { createSurfaceRouter } from "./factory.js";
import { composeSurfaceRouterOptions } from "../../framework/composeRouter.js";

export function createAdminRouter({ authStore, workspaceStore }) {
  const surfaceOptions = composeSurfaceRouterOptions("admin");

  return createSurfaceRouter({
    authStore,
    workspaceStore,
    surface: "admin",
    shellComponent: AdminShell,
    ...surfaceOptions
  });
}
