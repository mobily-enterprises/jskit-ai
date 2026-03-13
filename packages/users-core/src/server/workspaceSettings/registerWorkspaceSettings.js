import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createRepository as createWorkspaceSettingsRepository } from "./workspaceSettingsRepository.js";
import { createService as createWorkspaceSettingsService } from "./workspaceSettingsService.js";
import { workspaceSettingsActions } from "./workspaceSettingsActions.js";

function resolveWorkspaceSettingsDefaultInvitesEnabled(appConfig = {}) {
  const defaultInvitesEnabled = appConfig?.workspaceSettings?.defaults?.invitesEnabled;

  if (typeof defaultInvitesEnabled !== "boolean") {
    throw new TypeError("users.core requires appConfig.workspaceSettings.defaults.invitesEnabled.");
  }

  return defaultInvitesEnabled;
}

function registerWorkspaceSettings(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.actions !== "function") {
    throw new Error("registerWorkspaceSettings requires application singleton()/actions().");
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

  app.actions(
    withActionDefaults(workspaceSettingsActions, {
      domain: "workspace",
      dependencies: {
        workspaceSettingsService: "users.workspace.settings.service"
      }
    })
  );
}

export { registerWorkspaceSettings };
