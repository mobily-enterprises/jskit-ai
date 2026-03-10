import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  registerActionDefinitions,
  registerActionContextContributor
} from "@jskit-ai/kernel/server/actions";
import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import * as usersShared from "../shared/index.js";
import { createRepository as createUserProfilesRepository } from "./account/userProfilesRepository.js";
import { createRepository as createUserSettingsRepository } from "./account/userSettingsRepository.js";
import { createRepository as createWorkspacesRepository } from "./workspace/workspacesRepository.js";
import { createRepository as createWorkspaceMembershipsRepository } from "./workspace/workspaceMembershipsRepository.js";
import { createRepository as createWorkspaceSettingsRepository } from "./workspaceSettings/workspaceSettingsRepository.js";
import { createRepository as createWorkspaceInvitesRepository } from "./workspace/workspaceInvitesRepository.js";
import { createRepository as createConsoleSettingsRepository } from "./consoleSettings/consoleSettingsRepository.js";
import { createService as createWorkspaceService } from "./workspace/workspaceService.js";
import { createService as createWorkspaceAdminService } from "./workspace/workspaceAdminService.js";
import { createService as createWorkspaceSettingsService } from "./workspaceSettings/workspaceSettingsService.js";
import { createService as createSettingsService } from "./account/accountSettingsService.js";
import { createService as createConsoleSettingsService } from "./consoleSettings/consoleSettingsService.js";
import { workspaceBootstrapActions } from "./workspaceBootstrap/workspaceBootstrapActions.js";
import { registerWorkspaceBootstrapRoutes } from "./workspaceBootstrap/registerWorkspaceBootstrapRoutes.js";
import { workspaceDirectoryActions } from "./workspaceDirectory/workspaceDirectoryActions.js";
import { registerWorkspaceDirectoryRoutes } from "./workspaceDirectory/registerWorkspaceDirectoryRoutes.js";
import { workspacePendingInvitationsActions } from "./workspacePendingInvitations/workspacePendingInvitationsActions.js";
import { registerWorkspacePendingInvitationsRoutes } from "./workspacePendingInvitations/registerWorkspacePendingInvitationsRoutes.js";
import { workspaceMembersActions } from "./workspaceMembers/workspaceMembersActions.js";
import { registerWorkspaceMembersRoutes } from "./workspaceMembers/registerWorkspaceMembersRoutes.js";
import { workspaceSettingsActions } from "./workspaceSettings/workspaceSettingsActions.js";
import { registerWorkspaceSettingsRoutes } from "./workspaceSettings/registerWorkspaceSettingsRoutes.js";
import { createWorkspaceActionContextContributor } from "./workspace/workspaceActionContextContributor.js";
import { accountProfileActions } from "./accountProfile/accountProfileActions.js";
import { registerAccountProfileRoutes } from "./accountProfile/registerAccountProfileRoutes.js";
import { accountPreferencesActions } from "./accountPreferences/accountPreferencesActions.js";
import { registerAccountPreferencesRoutes } from "./accountPreferences/registerAccountPreferencesRoutes.js";
import { accountNotificationsActions } from "./accountNotifications/accountNotificationsActions.js";
import { registerAccountNotificationsRoutes } from "./accountNotifications/registerAccountNotificationsRoutes.js";
import { accountChatActions } from "./accountChat/accountChatActions.js";
import { registerAccountChatRoutes } from "./accountChat/registerAccountChatRoutes.js";
import { accountSecurityActions } from "./accountSecurity/accountSecurityActions.js";
import { registerAccountSecurityRoutes } from "./accountSecurity/registerAccountSecurityRoutes.js";
import { consoleSettingsActions } from "./consoleSettings/consoleSettingsActions.js";
import { registerConsoleSettingsRoutes } from "./consoleSettings/registerConsoleSettingsRoutes.js";

const USERS_CORE_API = Object.freeze({
  ...usersShared
});

const USERS_WORKSPACE_BOOTSTRAP_CONTRIBUTOR_TOKEN = "users.core.workspaceBootstrap.actionDefinitions";
const USERS_WORKSPACE_DIRECTORY_CONTRIBUTOR_TOKEN = "users.core.workspaceDirectory.actionDefinitions";
const USERS_WORKSPACE_PENDING_INVITATIONS_CONTRIBUTOR_TOKEN = "users.core.workspacePendingInvitations.actionDefinitions";
const USERS_WORKSPACE_MEMBERS_CONTRIBUTOR_TOKEN = "users.core.workspaceMembers.actionDefinitions";
const USERS_WORKSPACE_SETTINGS_ACTION_DEFINITIONS_TOKEN = "users.core.workspaceSettings.actionDefinitions";
const USERS_WORKSPACE_CONTEXT_CONTRIBUTOR_TOKEN = "users.core.workspace.actionContextContributor";
const USERS_ACCOUNT_PROFILE_ACTION_DEFINITIONS_TOKEN = "users.core.accountProfile.actionDefinitions";
const USERS_ACCOUNT_PREFERENCES_ACTION_DEFINITIONS_TOKEN = "users.core.accountPreferences.actionDefinitions";
const USERS_ACCOUNT_NOTIFICATIONS_ACTION_DEFINITIONS_TOKEN = "users.core.accountNotifications.actionDefinitions";
const USERS_ACCOUNT_CHAT_ACTION_DEFINITIONS_TOKEN = "users.core.accountChat.actionDefinitions";
const USERS_ACCOUNT_SECURITY_ACTION_DEFINITIONS_TOKEN = "users.core.accountSecurity.actionDefinitions";
const USERS_CONSOLE_SETTINGS_ACTION_DEFINITIONS_TOKEN = "users.core.console.settings.actionDefinitions";

class UsersCoreServiceProvider {
  static id = "users.core";

  static dependsOn = ["runtime.actions", "runtime.database", "auth.provider"];

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function") {
      throw new Error("UsersCoreServiceProvider requires application singleton()/has().");
    }

    app.singleton("users.core", () => USERS_CORE_API);

    app.singleton("userProfilesRepository", (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createUserProfilesRepository(knex);
    });

    app.singleton("userSettingsRepository", (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createUserSettingsRepository(knex);
    });

    app.singleton("workspacesRepository", (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createWorkspacesRepository(knex);
    });

    app.singleton("workspaceMembershipsRepository", (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createWorkspaceMembershipsRepository(knex);
    });

    app.singleton("workspaceSettingsRepository", (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createWorkspaceSettingsRepository(knex);
    });

    app.singleton("workspaceInvitesRepository", (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createWorkspaceInvitesRepository(knex);
    });

    app.singleton("consoleSettingsRepository", (scope) => {
      const knex = scope.make(KERNEL_TOKENS.Knex);
      return createConsoleSettingsRepository(knex);
    });

    app.singleton("users.workspace.service", (scope) => {
      const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
      return createWorkspaceService({
        appConfig,
        workspacesRepository: scope.make("workspacesRepository"),
        workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository"),
        workspaceSettingsRepository: scope.make("workspaceSettingsRepository"),
        workspaceInvitesRepository: scope.make("workspaceInvitesRepository"),
        userSettingsRepository: scope.make("userSettingsRepository"),
        userProfilesRepository: scope.make("userProfilesRepository")
      });
    });

    app.singleton(KERNEL_TOKENS.SurfaceRuntime, (scope) => {
      const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
      return createSurfaceRuntime({
        tenancyMode: appConfig.tenancyMode,
        allMode: appConfig.surfaceModeAll,
        surfaces: appConfig.surfaceDefinitions,
        defaultSurfaceId: appConfig.surfaceDefaultId
      });
    });

    app.singleton("users.workspace.admin.service", (scope) => {
      return createWorkspaceAdminService({
        workspacesRepository: scope.make("workspacesRepository"),
        workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository"),
        workspaceInvitesRepository: scope.make("workspaceInvitesRepository"),
        workspaceService: scope.make("users.workspace.service")
      });
    });

    app.singleton("users.workspace.settings.service", (scope) => {
      return createWorkspaceSettingsService({
        workspacesRepository: scope.make("workspacesRepository"),
        workspaceSettingsRepository: scope.make("workspaceSettingsRepository")
      });
    });

    app.singleton("users.settings.service", (scope) => {
      const authService = scope.has("authService") ? scope.make("authService") : null;
      return createSettingsService({
        userSettingsRepository: scope.make("userSettingsRepository"),
        userProfilesRepository: scope.make("userProfilesRepository"),
        authService
      });
    });

    app.singleton("users.console.settings.service", (scope) => {
      return createConsoleSettingsService({
        consoleSettingsRepository: scope.make("consoleSettingsRepository")
      });
    });

    registerActionDefinitions(app, USERS_WORKSPACE_BOOTSTRAP_CONTRIBUTOR_TOKEN, {
      contributorId: "users.workspace-bootstrap",
      domain: "workspace",
      dependencies: {
        workspaceService: "users.workspace.service"
      },
      actions: workspaceBootstrapActions
    });

    registerActionDefinitions(app, USERS_WORKSPACE_DIRECTORY_CONTRIBUTOR_TOKEN, {
      contributorId: "users.workspace-directory",
      domain: "workspace",
      dependencies: {
        workspaceService: "users.workspace.service"
      },
      actions: workspaceDirectoryActions
    });

    registerActionDefinitions(app, USERS_WORKSPACE_PENDING_INVITATIONS_CONTRIBUTOR_TOKEN, {
      contributorId: "users.workspace-pending-invitations",
      domain: "workspace",
      dependencies: {
        workspaceService: "users.workspace.service",
        workspaceAdminService: "users.workspace.admin.service"
      },
      actions: workspacePendingInvitationsActions
    });

    registerActionDefinitions(app, USERS_WORKSPACE_MEMBERS_CONTRIBUTOR_TOKEN, {
      contributorId: "users.workspace-members",
      domain: "workspace",
      dependencies: {
        workspaceAdminService: "users.workspace.admin.service"
      },
      actions: workspaceMembersActions
    });

    registerActionDefinitions(app, USERS_WORKSPACE_SETTINGS_ACTION_DEFINITIONS_TOKEN, {
      contributorId: "users.workspace-settings",
      domain: "workspace",
      dependencies: {
        workspaceSettingsService: "users.workspace.settings.service"
      },
      actions: workspaceSettingsActions
    });

    registerActionContextContributor(app, USERS_WORKSPACE_CONTEXT_CONTRIBUTOR_TOKEN, (scope) => {
      return createWorkspaceActionContextContributor({
        workspaceService: scope.make("users.workspace.service")
      });
    });

    registerActionDefinitions(app, USERS_ACCOUNT_PROFILE_ACTION_DEFINITIONS_TOKEN, {
      contributorId: "users.account-profile",
      domain: "settings",
      dependencies: {
        settingsService: "users.settings.service"
      },
      actions: accountProfileActions
    });

    registerActionDefinitions(app, USERS_ACCOUNT_PREFERENCES_ACTION_DEFINITIONS_TOKEN, {
      contributorId: "users.account-preferences",
      domain: "settings",
      dependencies: {
        settingsService: "users.settings.service"
      },
      actions: accountPreferencesActions
    });

    registerActionDefinitions(app, USERS_ACCOUNT_NOTIFICATIONS_ACTION_DEFINITIONS_TOKEN, {
      contributorId: "users.account-notifications",
      domain: "settings",
      dependencies: {
        settingsService: "users.settings.service"
      },
      actions: accountNotificationsActions
    });

    registerActionDefinitions(app, USERS_ACCOUNT_CHAT_ACTION_DEFINITIONS_TOKEN, {
      contributorId: "users.account-chat",
      domain: "settings",
      dependencies: {
        settingsService: "users.settings.service"
      },
      actions: accountChatActions
    });

    registerActionDefinitions(app, USERS_ACCOUNT_SECURITY_ACTION_DEFINITIONS_TOKEN, {
      contributorId: "users.account-security",
      domain: "settings",
      dependencies: {
        settingsService: "users.settings.service"
      },
      actions: accountSecurityActions
    });

    registerActionDefinitions(app, USERS_CONSOLE_SETTINGS_ACTION_DEFINITIONS_TOKEN, {
      contributorId: "users.console-settings",
      domain: "console",
      dependencies: {
        consoleSettingsService: "users.console.settings.service"
      },
      actions: consoleSettingsActions
    });
  }

  boot(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("UsersCoreServiceProvider requires application has().");
    }

    if (!app.has("authService")) {
      throw new Error("UsersCoreServiceProvider requires authService binding.");
    }
    if (!app.has("actionExecutor")) {
      throw new Error("UsersCoreServiceProvider requires actionExecutor binding.");
    }

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

export { UsersCoreServiceProvider };
