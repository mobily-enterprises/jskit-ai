import AppShell from "./shells/app/AppShell.vue";
import { createSurfaceRouter } from "./routerFactory.js";

export function createAppRouter({ authStore, workspaceStore }) {
  return createSurfaceRouter({
    authStore,
    workspaceStore,
    surface: "app",
    shellComponent: AppShell,
    includeWorkspaceSettings: false,
    includeAssistantRoute: true,
    includeChoiceTwoRoute: false
  });
}
