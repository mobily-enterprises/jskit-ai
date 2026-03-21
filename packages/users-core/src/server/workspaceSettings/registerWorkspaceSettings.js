import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import {
  WORKSPACE_SETTINGS_CHANGED_EVENT
} from "../../shared/events/usersEvents.js";
import { deepFreeze } from "../common/support/deepFreeze.js";
import { createRepository as createWorkspaceSettingsRepository } from "./workspaceSettingsRepository.js";
import { createService as createWorkspaceSettingsService } from "./workspaceSettingsService.js";
import { workspaceSettingsActions } from "./workspaceSettingsActions.js";
import { createWorkspaceRoleCatalog } from "../../shared/roles.js";
import { USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN } from "../common/diTokens.js";
import { createWorkspaceEntityAndBootstrapEvents } from "../common/support/realtimeServiceEvents.js";

function resolveWorkspaceSettingsDefaultInvitesEnabled(appConfig = {}) {
  const defaultInvitesEnabled = appConfig?.workspaceSettings?.defaults?.invitesEnabled;

  if (typeof defaultInvitesEnabled !== "boolean") {
    throw new TypeError("users.core requires appConfig.workspaceSettings.defaults.invitesEnabled.");
  }

  return defaultInvitesEnabled;
}

function registerWorkspaceSettings(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.actions !== "function" || typeof app.service !== "function") {
    throw new Error("registerWorkspaceSettings requires application singleton()/service()/actions().");
  }

  app.singleton("workspaceSettingsRepository", (scope) => {
    const knex = scope.make(KERNEL_TOKENS.Knex);
    const appConfig = resolveAppConfig(scope);
    return createWorkspaceSettingsRepository(knex, {
      defaultInvitesEnabled: resolveWorkspaceSettingsDefaultInvitesEnabled(appConfig)
    });
  });

  app.service(
    "users.workspace.settings.service",
    (scope) =>
      createWorkspaceSettingsService({
        workspaceSettingsRepository: scope.make("workspaceSettingsRepository"),
        workspaceInvitationsEnabled: scope.make(USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN),
        roleCatalog: createWorkspaceRoleCatalog(resolveAppConfig(scope))
      }),
    {
      events: deepFreeze({
        updateWorkspaceSettings: createWorkspaceEntityAndBootstrapEvents({
          workspaceEntity: "settings",
          workspaceOperation: "updated",
          workspaceRealtimeEvent: WORKSPACE_SETTINGS_CHANGED_EVENT
        })
      })
    }
  );

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
