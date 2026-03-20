import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createService } from "./workspacePendingInvitationsService.js";
import { workspacePendingInvitationsActions } from "./workspacePendingInvitationsActions.js";
import {
  USERS_BOOTSTRAP_CHANGED_EVENT,
  WORKSPACE_INVITES_CHANGED_EVENT,
  WORKSPACE_MEMBERS_CHANGED_EVENT,
  WORKSPACES_CHANGED_EVENT,
  WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT
} from "../../shared/events/usersEvents.js";
import { deepFreeze } from "../common/support/deepFreeze.js";
import {
  USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN
} from "../common/diTokens.js";

function workspaceAudienceFromEntityId({ event } = {}) {
  const workspaceId = Number(event?.entityId);
  if (!Number.isInteger(workspaceId) || workspaceId < 1) {
    return "none";
  }
  return {
    workspaceId
  };
}

function registerWorkspacePendingInvitations(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
    throw new Error("registerWorkspacePendingInvitations requires application singleton()/service()/actions().");
  }

  app.service(
    USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN,
    (scope) =>
      createService({
        workspaceInvitesRepository: scope.make("workspaceInvitesRepository"),
        workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository")
      }),
    {
      events: deepFreeze({
        acceptInviteByToken: [
          {
            type: "entity.changed",
            source: "workspace",
            entity: "invitation",
            operation: "updated",
            entityId: ({ options }) => Number(options?.context?.actor?.id || 0),
            realtime: {
              event: WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT,
              audience: "actor_user"
            }
          },
          {
            type: "entity.changed",
            source: "users",
            entity: "bootstrap",
            operation: "updated",
            entityId: ({ options }) => Number(options?.context?.actor?.id || 0),
            realtime: {
              event: USERS_BOOTSTRAP_CHANGED_EVENT,
              audience: "actor_user"
            }
          },
          {
            type: "entity.changed",
            source: "workspace",
            entity: "directory",
            operation: "updated",
            entityId: ({ options }) => Number(options?.context?.actor?.id || 0),
            realtime: {
              event: WORKSPACES_CHANGED_EVENT,
              audience: "actor_user"
            }
          },
          {
            type: "entity.changed",
            source: "workspace",
            entity: "member",
            operation: "updated",
            entityId: ({ result }) => result?.workspaceId,
            realtime: {
              event: WORKSPACE_MEMBERS_CHANGED_EVENT,
              audience: workspaceAudienceFromEntityId
            }
          },
          {
            type: "entity.changed",
            source: "workspace",
            entity: "invite",
            operation: "updated",
            entityId: ({ result }) => result?.workspaceId,
            realtime: {
              event: WORKSPACE_INVITES_CHANGED_EVENT,
              audience: workspaceAudienceFromEntityId
            }
          }
        ],
        refuseInviteByToken: [
          {
            type: "entity.changed",
            source: "workspace",
            entity: "invitation",
            operation: "updated",
            entityId: ({ options }) => Number(options?.context?.actor?.id || 0),
            realtime: {
              event: WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT,
              audience: "actor_user"
            }
          },
          {
            type: "entity.changed",
            source: "users",
            entity: "bootstrap",
            operation: "updated",
            entityId: ({ options }) => Number(options?.context?.actor?.id || 0),
            realtime: {
              event: USERS_BOOTSTRAP_CHANGED_EVENT,
              audience: "actor_user"
            }
          },
          {
            type: "entity.changed",
            source: "workspace",
            entity: "invite",
            operation: "updated",
            entityId: ({ result }) => result?.workspaceId,
            realtime: {
              event: WORKSPACE_INVITES_CHANGED_EVENT,
              audience: workspaceAudienceFromEntityId
            }
          }
        ]
      })
    }
  );

  app.actions(
    withActionDefaults(workspacePendingInvitationsActions, {
      domain: "workspace",
      dependencies: {
        workspacePendingInvitationsService: USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN
      }
    })
  );
}

export { registerWorkspacePendingInvitations };
