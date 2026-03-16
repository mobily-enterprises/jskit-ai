import { USERS_SHARED_API } from "../shared/index.js";
import { bootWorkspaceDirectoryRoutes } from "./workspaceDirectory/bootWorkspaceDirectoryRoutes.js";
import { registerWorkspaceDirectory } from "./workspaceDirectory/registerWorkspaceDirectory.js";
import {
  registerWorkspacePendingInvitations
} from "./workspacePendingInvitations/registerWorkspacePendingInvitations.js";
import { bootWorkspacePendingInvitations } from "./workspacePendingInvitations/bootWorkspacePendingInvitations.js";
import { registerWorkspaceMembers } from "./workspaceMembers/registerWorkspaceMembers.js";
import { bootWorkspaceMembers } from "./workspaceMembers/bootWorkspaceMembers.js";
import { registerWorkspaceSettings } from "./workspaceSettings/registerWorkspaceSettings.js";
import { bootWorkspaceSettings } from "./workspaceSettings/bootWorkspaceSettings.js";
import { bootAccountProfileRoutes } from "./accountProfile/bootAccountProfileRoutes.js";
import { bootAccountPreferencesRoutes } from "./accountPreferences/bootAccountPreferencesRoutes.js";
import { bootAccountNotificationsRoutes } from "./accountNotifications/bootAccountNotificationsRoutes.js";
import { bootAccountSecurityRoutes } from "./accountSecurity/bootAccountSecurityRoutes.js";
import { bootConsoleSettingsRoutes } from "./consoleSettings/bootConsoleSettingsRoutes.js";
import {
  USERS_WORKSPACE_TENANCY_ENABLED_TOKEN
} from "./common/diTokens.js";
import { registerUsersCoreApi } from "./common/registerUsersCoreApi.js";
import { registerCommonRepositories } from "./common/registerCommonRepositories.js";
import { registerWorkspaceCore } from "./registerWorkspaceCore.js";
import { registerWorkspaceBootstrap } from "./registerWorkspaceBootstrap.js";
import { registerAccountPreferences } from "./accountPreferences/registerAccountPreferences.js";
import { registerAccountNotifications } from "./accountNotifications/registerAccountNotifications.js";
import { registerAccountProfile } from "./accountProfile/registerAccountProfile.js";
import { registerAccountSecurity } from "./accountSecurity/registerAccountSecurity.js";
import { registerConsoleSettings } from "./consoleSettings/registerConsoleSettings.js";

class UsersCoreServiceProvider {
  static id = "users.core";

  static dependsOn = ["runtime.server", "runtime.actions", "runtime.database", "runtime.storage", "auth.provider"];

  register(app) {
    registerUsersCoreApi(app, USERS_SHARED_API);
    registerCommonRepositories(app);
    registerWorkspaceCore(app);
    registerWorkspaceDirectory(app);
    registerWorkspacePendingInvitations(app);
    registerWorkspaceBootstrap(app);
    registerWorkspaceMembers(app);
    registerWorkspaceSettings(app);
    registerAccountProfile(app);
    registerAccountPreferences(app);
    registerAccountNotifications(app);
    registerAccountSecurity(app);
    registerConsoleSettings(app);
  }

  boot(app) {
    bootWorkspaceDirectoryRoutes(app);
    if (app.make(USERS_WORKSPACE_TENANCY_ENABLED_TOKEN) === true) {
      bootWorkspacePendingInvitations(app);
    }
    bootWorkspaceSettings(app);
    bootWorkspaceMembers(app);
    bootAccountProfileRoutes(app);
    bootAccountPreferencesRoutes(app);
    bootAccountNotificationsRoutes(app);
    bootAccountSecurityRoutes(app);
    bootConsoleSettingsRoutes(app);
  }
}

export { UsersCoreServiceProvider };
