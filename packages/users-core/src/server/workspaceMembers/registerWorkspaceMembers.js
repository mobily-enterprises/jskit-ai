import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import {
  USERS_BOOTSTRAP_CHANGED_EVENT,
  WORKSPACE_MEMBERS_CHANGED_EVENT,
  WORKSPACE_INVITES_CHANGED_EVENT
} from "../../shared/events/usersEvents.js";
import { deepFreeze } from "../common/support/deepFreeze.js";
import { createService as createWorkspaceMembersService } from "./workspaceMembersService.js";
import { workspaceMembersActions } from "./workspaceMembersActions.js";
import { materializeWorkspaceActionSurfacesFromAppConfig } from "../support/workspaceActionSurfaces.js";

const USERS_WORKSPACE_MEMBERS_SERVICE_TOKEN = "users.workspace.members.service";

function resolveWorkspaceMembersInviteExpiresInMs(appConfig = {}) {
  const inviteExpiresInMs = Number(appConfig?.workspaceMembers?.defaults?.inviteExpiresInMs);
  if (!Number.isInteger(inviteExpiresInMs) || inviteExpiresInMs < 1) {
    throw new TypeError("users.core requires appConfig.workspaceMembers.defaults.inviteExpiresInMs.");
  }

  return inviteExpiresInMs;
}

function registerWorkspaceMembers(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
    throw new Error("registerWorkspaceMembers requires application singleton()/service()/actions().");
  }
  const appConfig = typeof app.has === "function" && app.has("appConfig") ? app.make("appConfig") : {};

  app.service(
    USERS_WORKSPACE_MEMBERS_SERVICE_TOKEN,
    (scope) => {
      const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
      return createWorkspaceMembersService({
        workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository"),
        workspaceInvitesRepository: scope.make("workspaceInvitesRepository"),
        inviteExpiresInMs: resolveWorkspaceMembersInviteExpiresInMs(appConfig)
      });
    },
    {
      events: deepFreeze({
        updateMemberRole: [
          {
            type: "entity.changed",
            source: "workspace",
            entity: "member",
            operation: "updated",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: {
              event: WORKSPACE_MEMBERS_CHANGED_EVENT,
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
        ],
        createInvite: [
          {
            type: "entity.changed",
            source: "workspace",
            entity: "invite",
            operation: "created",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: {
              event: WORKSPACE_INVITES_CHANGED_EVENT,
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
        ],
        revokeInvite: [
          {
            type: "entity.changed",
            source: "workspace",
            entity: "invite",
            operation: "updated",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: {
              event: WORKSPACE_INVITES_CHANGED_EVENT,
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
      withActionDefaults(workspaceMembersActions, {
        domain: "workspace",
        dependencies: {
          workspaceMembersService: USERS_WORKSPACE_MEMBERS_SERVICE_TOKEN
        }
      }),
      { appConfig }
    )
  );
}

export { registerWorkspaceMembers };
