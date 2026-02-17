import App from "./App.vue";
import { createSurfaceRouter } from "./routerFactory";

export function createAdminRouter({ authStore, workspaceStore }) {
  return createSurfaceRouter({
    authStore,
    workspaceStore,
    surface: "admin",
    shellComponent: App,
    includeWorkspaceSettings: true
  });
}

export const createAppRouter = createAdminRouter;
