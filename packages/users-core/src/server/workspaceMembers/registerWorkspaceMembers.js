import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import {
  WORKSPACE_MEMBERS_CHANGED_EVENT,
  WORKSPACE_INVITES_CHANGED_EVENT
} from "../../shared/events/usersEvents.js";
import { createService as createWorkspaceMembersService } from "./workspaceMembersService.js";
import { workspaceMembersActions } from "./workspaceMembersActions.js";

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
      events: Object.freeze({
        updateMemberRole: Object.freeze([
          Object.freeze({
            type: "entity.changed",
            source: "workspace",
            entity: "member",
            operation: "updated",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: Object.freeze({
              event: WORKSPACE_MEMBERS_CHANGED_EVENT,
              payload: ({ args }) => Object.freeze({
                workspaceSlug: String(args?.[0]?.slug || "").trim()
              }),
              audience: "all_workspace_users"
            })
          })
        ]),
        createInvite: Object.freeze([
          Object.freeze({
            type: "entity.changed",
            source: "workspace",
            entity: "invite",
            operation: "created",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: Object.freeze({
              event: WORKSPACE_INVITES_CHANGED_EVENT,
              payload: ({ args }) => Object.freeze({
                workspaceSlug: String(args?.[0]?.slug || "").trim()
              }),
              audience: "all_workspace_users"
            })
          })
        ]),
        revokeInvite: Object.freeze([
          Object.freeze({
            type: "entity.changed",
            source: "workspace",
            entity: "invite",
            operation: "updated",
            entityId: ({ args }) => args?.[0]?.id,
            realtime: Object.freeze({
              event: WORKSPACE_INVITES_CHANGED_EVENT,
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
    withActionDefaults(workspaceMembersActions, {
      domain: "workspace",
      dependencies: {
        workspaceMembersService: USERS_WORKSPACE_MEMBERS_SERVICE_TOKEN
      }
    })
  );
}

export { registerWorkspaceMembers };
