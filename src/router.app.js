import AppShell from "./shells/app/AppShell.vue";
import { createSurfaceRouter } from "./routerFactory.js";

export function createCustomerRouter({ authStore, workspaceStore }) {
  return createSurfaceRouter({
    authStore,
    workspaceStore,
    surface: "app",
    shellComponent: AppShell,
    includeWorkspaceSettings: false
  });
}
