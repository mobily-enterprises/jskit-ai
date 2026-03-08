import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerActionContributor } from "@jskit-ai/kernel/server/actions";
import * as usersShared from "../../shared/index.js";
import { createRepository as createUserProfilesRepository } from "../repositories/userProfiles.repository.js";
import { createRepository as createUserSettingsRepository } from "../repositories/userSettings.repository.js";
import { createRepository as createWorkspacesRepository } from "../repositories/workspaces.repository.js";
import { createRepository as createWorkspaceMembershipsRepository } from "../repositories/memberships.repository.js";
import { createRepository as createWorkspaceSettingsRepository } from "../repositories/workspaceSettings.repository.js";
import { createRepository as createWorkspaceInvitesRepository } from "../repositories/workspaceInvites.repository.js";
import { createService as createWorkspaceService } from "../services/workspaceService.js";
import { createService as createWorkspaceAdminService } from "../services/workspaceAdminService.js";
import { createService as createSettingsService } from "../services/settingsService.js";
import { createWorkspaceActionContributor } from "../actions/workspaceActionContributor.js";
import { createSettingsActionContributor } from "../actions/settingsActionContributor.js";

const USERS_CORE_API = Object.freeze({
  ...usersShared
});

const USERS_WORKSPACE_CONTRIBUTOR_TOKEN = "users.core.workspace.actionContributor";
const USERS_SETTINGS_CONTRIBUTOR_TOKEN = "users.core.settings.actionContributor";

class UsersCoreServiceProvider {
  static id = "users.core";

  static dependsOn = ["runtime.actions", "runtime.database"];

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

    app.singleton("users.workspace.admin.service", (scope) => {
      return createWorkspaceAdminService({
        workspacesRepository: scope.make("workspacesRepository"),
        workspaceSettingsRepository: scope.make("workspaceSettingsRepository"),
        workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository"),
        workspaceInvitesRepository: scope.make("workspaceInvitesRepository"),
        workspaceService: scope.make("users.workspace.service")
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

    registerActionContributor(app, USERS_WORKSPACE_CONTRIBUTOR_TOKEN, (scope) => {
      return createWorkspaceActionContributor({
        workspaceService: scope.make("users.workspace.service"),
        workspaceAdminService: scope.make("users.workspace.admin.service")
      });
    });

    registerActionContributor(app, USERS_SETTINGS_CONTRIBUTOR_TOKEN, (scope) => {
      return createSettingsActionContributor({
        settingsService: scope.make("users.settings.service")
      });
    });
  }
}

export { UsersCoreServiceProvider };
