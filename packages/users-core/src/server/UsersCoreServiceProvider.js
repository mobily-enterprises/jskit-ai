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
  USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN,
  USERS_WORKSPACE_ENABLED_TOKEN
} from "./common/diTokens.js";
import { registerSharedApi } from "./common/registerSharedApi.js";
import { registerCommonRepositories } from "./common/registerCommonRepositories.js";
import { registerWorkspaceCore } from "./registerWorkspaceCore.js";
import { registerWorkspaceBootstrap } from "./registerWorkspaceBootstrap.js";
import { registerAccountPreferences } from "./accountPreferences/registerAccountPreferences.js";
import { registerAccountNotifications } from "./accountNotifications/registerAccountNotifications.js";
import { registerAccountProfile } from "./accountProfile/registerAccountProfile.js";
import { registerAccountSecurity } from "./accountSecurity/registerAccountSecurity.js";
import { registerConsoleSettings } from "./consoleSettings/registerConsoleSettings.js";
import { registerAvatarMultipartSupport } from "./accountProfile/registerAvatarMultipartSupport.js";
import { registerUsersCoreActionSurfaceSources } from "./support/workspaceActionSurfaces.js";

class UsersCoreServiceProvider {
  static id = "users.core";

  static dependsOn = ["runtime.server", "runtime.actions", "runtime.database", "runtime.storage", "auth.provider"];

  register(app) {
    registerUsersCoreActionSurfaceSources(app);
    registerSharedApi(app, USERS_SHARED_API);
    registerCommonRepositories(app);
    registerWorkspaceCore(app);
    registerWorkspaceBootstrap(app);

    if (app.make(USERS_WORKSPACE_ENABLED_TOKEN) === true) {
      registerWorkspaceDirectory(app);
      registerWorkspaceMembers(app);
      registerWorkspaceSettings(app);

      if (app.make(USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN) === true) {
        registerWorkspacePendingInvitations(app);
      }
    }

    registerAccountProfile(app);
    registerAccountPreferences(app);
    registerAccountNotifications(app);
    registerAccountSecurity(app);
    registerConsoleSettings(app);
  }

  async boot(app) {
    if (app.make(USERS_WORKSPACE_ENABLED_TOKEN) === true) {
      bootWorkspaceDirectoryRoutes(app);
      if (app.make(USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN) === true) {
        bootWorkspacePendingInvitations(app);
      }
      bootWorkspaceSettings(app);
      bootWorkspaceMembers(app);
    }
    await registerAvatarMultipartSupport(app);
    bootAccountProfileRoutes(app);
    bootAccountPreferencesRoutes(app);
    bootAccountNotificationsRoutes(app);
    bootAccountSecurityRoutes(app);
    bootConsoleSettingsRoutes(app);
  }
}

export { UsersCoreServiceProvider };
