import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import {
  USERS_BOOTSTRAP_CHANGED_EVENT,
  WORKSPACE_SETTINGS_CHANGED_EVENT
} from "../../shared/events/usersEvents.js";
import { deepFreeze } from "../common/support/deepFreeze.js";
import { createRepository as createWorkspaceSettingsRepository } from "./workspaceSettingsRepository.js";
import { createService as createWorkspaceSettingsService } from "./workspaceSettingsService.js";
import { workspaceSettingsActions } from "./workspaceSettingsActions.js";
import { materializeWorkspaceActionSurfacesFromAppConfig } from "../support/workspaceActionSurfaces.js";
import { createWorkspaceRoleCatalog } from "../../shared/roles.js";
import { USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN } from "../common/diTokens.js";

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
  const appConfig = typeof app.has === "function" && app.has("appConfig") ? app.make("appConfig") : {};

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
        workspaceSettingsRepository: scope.make("workspaceSettingsRepository"),
        workspaceInvitationsEnabled: scope.make(USERS_WORKSPACE_INVITATIONS_ENABLED_TOKEN),
        roleCatalog: createWorkspaceRoleCatalog(scope.has("appConfig") ? scope.make("appConfig") : {})
      }),
    {
      events: deepFreeze({
        updateWorkspaceSettings: [
          {
            type: "entity.changed",
            source: "workspace",
            entity: "settings",
            operation: "updated",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: {
              event: WORKSPACE_SETTINGS_CHANGED_EVENT,
              payload: ({ args }) => ({
                workspaceSlug: String(args?.[0]?.slug || "").trim()
              }),
              audience: "event_scope"
            }
          },
          {
            type: "entity.changed",
            source: "users",
            entity: "bootstrap",
            operation: "updated",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: {
              event: USERS_BOOTSTRAP_CHANGED_EVENT,
              audience: "event_scope"
            }
          }
        ]
      })
    }
  );

  app.actions(
    materializeWorkspaceActionSurfacesFromAppConfig(
      withActionDefaults(workspaceSettingsActions, {
        domain: "workspace",
        dependencies: {
          workspaceSettingsService: "users.workspace.settings.service"
        }
      }),
      { appConfig }
    )
  );
}

export { registerWorkspaceSettings };
