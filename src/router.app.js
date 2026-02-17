import AppApp from "./AppApp.vue";
import { createSurfaceRouter } from "./routerFactory";

export function createCustomerRouter({ authStore, workspaceStore }) {
  return createSurfaceRouter({
    authStore,
    workspaceStore,
    surface: "app",
    shellComponent: AppApp,
    includeWorkspaceSettings: false
  });
}
