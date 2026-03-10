import { registerWorkspaceBootstrapRoutes } from "../workspaceBootstrap/registerWorkspaceBootstrapRoutes.js";
import { registerWorkspaceDirectoryRoutes } from "../workspaceDirectory/registerWorkspaceDirectoryRoutes.js";
import { registerWorkspacePendingInvitationsRoutes } from "../workspacePendingInvitations/registerWorkspacePendingInvitationsRoutes.js";
import { registerWorkspaceSettingsRoutes } from "../workspaceSettings/registerWorkspaceSettingsRoutes.js";
import { registerWorkspaceMembersRoutes } from "../workspaceMembers/registerWorkspaceMembersRoutes.js";
import { registerAccountProfileRoutes } from "../accountProfile/registerAccountProfileRoutes.js";
import { registerAccountPreferencesRoutes } from "../accountPreferences/registerAccountPreferencesRoutes.js";
import { registerAccountNotificationsRoutes } from "../accountNotifications/registerAccountNotificationsRoutes.js";
import { registerAccountChatRoutes } from "../accountChat/registerAccountChatRoutes.js";
import { registerAccountSecurityRoutes } from "../accountSecurity/registerAccountSecurityRoutes.js";
import { registerConsoleSettingsRoutes } from "../consoleSettings/registerConsoleSettingsRoutes.js";

class UsersRouteServiceProvider {
  static id = "users.routes";

  static dependsOn = ["users.core", "auth.provider", "runtime.actions"];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("UsersRouteServiceProvider requires application has().");
    }

    if (!app.has("authService")) {
      throw new Error("UsersRouteServiceProvider requires authService binding.");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("UsersRouteServiceProvider requires actionExecutor binding.");
    }
  }

  boot(app) {
    registerWorkspaceBootstrapRoutes(app);
    registerWorkspaceDirectoryRoutes(app);
    registerWorkspacePendingInvitationsRoutes(app);
    registerWorkspaceSettingsRoutes(app);
    registerWorkspaceMembersRoutes(app);
    registerAccountProfileRoutes(app);
    registerAccountPreferencesRoutes(app);
    registerAccountNotificationsRoutes(app);
    registerAccountChatRoutes(app);
    registerAccountSecurityRoutes(app);
    registerConsoleSettingsRoutes(app);
  }
}

export { UsersRouteServiceProvider };
