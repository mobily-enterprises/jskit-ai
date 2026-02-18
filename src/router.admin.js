import AdminShell from "./shells/admin/AdminShell.vue";
import { createSurfaceRouter } from "./routerFactory.js";

export function createAdminRouter({ authStore, workspaceStore }) {
  return createSurfaceRouter({
    authStore,
    workspaceStore,
    surface: "admin",
    shellComponent: AdminShell,
    includeWorkspaceSettings: true
  });
}
