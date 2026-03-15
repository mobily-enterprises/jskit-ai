import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createService } from "./workspacePendingInvitationsService.js";
import { workspacePendingInvitationsActions } from "./workspacePendingInvitationsActions.js";
import {
  WORKSPACES_CHANGED_EVENT,
  WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT
} from "../../shared/events/usersEvents.js";
import {
  USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN
} from "../common/diTokens.js";

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
      permissions: Object.freeze({
        listPendingInvitesForUser: Object.freeze({
          require: "authenticated"
        }),
        acceptInviteByToken: Object.freeze({
          require: "authenticated"
        }),
        refuseInviteByToken: Object.freeze({
          require: "authenticated"
        })
      }),
      events: Object.freeze({
        acceptInviteByToken: Object.freeze([
          Object.freeze({
            type: "entity.changed",
            source: "workspace",
            entity: "invitation",
            operation: "updated",
            entityId: ({ options }) => Number(options?.context?.actor?.id || 0),
            realtime: Object.freeze({
              event: WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT,
              audience: "actor_user"
            })
          }),
          Object.freeze({
            type: "entity.changed",
            source: "workspace",
            entity: "directory",
            operation: "updated",
            entityId: ({ options }) => Number(options?.context?.actor?.id || 0),
            realtime: Object.freeze({
              event: WORKSPACES_CHANGED_EVENT,
              audience: "actor_user"
            })
          })
        ]),
        refuseInviteByToken: Object.freeze([
          Object.freeze({
            type: "entity.changed",
            source: "workspace",
            entity: "invitation",
            operation: "updated",
            entityId: ({ options }) => Number(options?.context?.actor?.id || 0),
            realtime: Object.freeze({
              event: WORKSPACE_PENDING_INVITATIONS_CHANGED_EVENT,
              audience: "actor_user"
            })
          })
        ])
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
