import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { INTERNAL_JSON_REST_API } from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { deepFreeze } from "../common/support/deepFreeze.js";
import { createRepository as createWorkspaceSettingsRepository } from "./workspaceSettingsRepository.js";
import { createService as createWorkspaceSettingsService } from "./workspaceSettingsService.js";
import { workspaceSettingsActions } from "./workspaceSettingsActions.js";
import { createWorkspaceRoleCatalog } from "../../shared/roles.js";
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

  app.singleton("internal.repository.workspace-settings", (scope) => {
    const api = scope.make(INTERNAL_JSON_REST_API);
    const knex = scope.make("jskit.database.knex");
    const appConfig = resolveAppConfig(scope);
    return createWorkspaceSettingsRepository({
      api,
      knex,
      defaultInvitesEnabled: resolveWorkspaceSettingsDefaultInvitesEnabled(appConfig)
    });
  });

  app.service(
    "workspaces.settings.service",
    (scope) =>
      createWorkspaceSettingsService({
        workspaceSettingsRepository: scope.make("internal.repository.workspace-settings"),
        workspaceInvitationsEnabled: scope.make("workspaces.invitations.enabled"),
        roleCatalog: createWorkspaceRoleCatalog(resolveAppConfig(scope))
      }),
    {
      events: deepFreeze({
        updateWorkspaceSettings: createWorkspaceEntityAndBootstrapEvents({
          workspaceEntity: "settings",
          workspaceOperation: "updated",
          workspaceRealtimeEvent: "workspace.settings.changed"
        })
      })
    }
  );

  app.actions(
    withActionDefaults(workspaceSettingsActions, {
      domain: "workspace",
      dependencies: {
        workspaceSettingsService: "workspaces.settings.service"
      }
    })
  );
}

export { registerWorkspaceSettings };
