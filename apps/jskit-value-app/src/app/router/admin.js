import AdminShell from "../shells/admin/AdminShell.vue";
import { createSurfaceRouter } from "./factory.js";

export function createAdminRouter({ authStore, workspaceStore }) {
  return createSurfaceRouter({
    authStore,
    workspaceStore,
    surface: "admin",
    shellComponent: AdminShell,
    includeWorkspaceSettings: true,
    includeAssistantRoute: true,
    includeChatRoute: true,
    includeSocialRoute: true,
    includeSocialModerationRoute: true
  });
}
