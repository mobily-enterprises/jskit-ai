import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { WORKSPACE_SETTINGS_CHANGED_EVENT } from "../../shared/events/usersEvents.js";
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
  if (!app || typeof app.singleton !== "function" || typeof app.actions !== "function" || typeof app.service !== "function") {
    throw new Error("registerWorkspaceSettings requires application singleton()/service()/actions().");
  }

  app.singleton("workspaceSettingsRepository", (scope) => {
    const knex = scope.make(KERNEL_TOKENS.Knex);
    const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
    return createWorkspaceSettingsRepository(knex, {
      defaultInvitesEnabled: resolveWorkspaceSettingsDefaultInvitesEnabled(appConfig)
    });
  });

  app.service(
    "users.workspace.settings.service",
    (scope) =>
      createWorkspaceSettingsService({
        workspacesRepository: scope.make("workspacesRepository"),
        workspaceSettingsRepository: scope.make("workspaceSettingsRepository")
      }),
    {
      events: Object.freeze({
        updateWorkspaceSettings: Object.freeze([
          Object.freeze({
            type: "entity.changed",
            source: "workspace",
            entity: "settings",
            operation: "updated",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: Object.freeze({
              event: WORKSPACE_SETTINGS_CHANGED_EVENT,
              payload: ({ args }) => Object.freeze({
                workspaceSlug: String(args?.[0]?.slug || "").trim()
              }),
              audience: "all_workspace_users"
            })
          })
        ])
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
