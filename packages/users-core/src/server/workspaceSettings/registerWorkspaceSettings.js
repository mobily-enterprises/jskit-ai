import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createRepository as createWorkspaceSettingsRepository } from "./workspaceSettingsRepository.js";
import { createService as createWorkspaceSettingsService } from "./workspaceSettingsService.js";
import { workspaceSettingsActions } from "./workspaceSettingsActions.js";

const USERS_WORKSPACE_SETTINGS_ACTION_DEFINITIONS_TOKEN = "users.core.workspaceSettings.actionDefinitions";

function resolveWorkspaceSettingsDefaultInvitesEnabled(appConfig = {}) {
  const defaultInvitesEnabled = appConfig?.workspaceSettings?.defaults?.invitesEnabled;

  if (typeof defaultInvitesEnabled !== "boolean") {
    throw new TypeError("users.core requires appConfig.workspaceSettings.defaults.invitesEnabled.");
  }

  return defaultInvitesEnabled;
}

function registerWorkspaceSettings(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerWorkspaceSettings requires application singleton().");
  }

  app.singleton("workspaceSettingsRepository", (scope) => {
    const knex = scope.make(KERNEL_TOKENS.Knex);
    const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
    return createWorkspaceSettingsRepository(knex, {
      defaultInvitesEnabled: resolveWorkspaceSettingsDefaultInvitesEnabled(appConfig)
    });
  });

  app.singleton("users.workspace.settings.service", (scope) => {
    return createWorkspaceSettingsService({
      workspacesRepository: scope.make("workspacesRepository"),
      workspaceSettingsRepository: scope.make("workspaceSettingsRepository")
    });
  });

  registerActionDefinitions(app, USERS_WORKSPACE_SETTINGS_ACTION_DEFINITIONS_TOKEN, {
    contributorId: "users.workspace-settings",
    domain: "workspace",
    dependencies: {
      workspaceSettingsService: "users.workspace.settings.service"
    },
    actions: workspaceSettingsActions
  });
}

export { registerWorkspaceSettings };
