import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createService } from "./workspacePendingInvitationsService.js";
import { workspacePendingInvitationsActions } from "./workspacePendingInvitationsActions.js";
import {
  USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN
} from "../common/diTokens.js";

function registerWorkspacePendingInvitations(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.actions !== "function") {
    throw new Error("registerWorkspacePendingInvitations requires application singleton()/actions().");
  }

  app.singleton(USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN, (scope) => {
    return createService({
      workspaceInvitesRepository: scope.make("workspaceInvitesRepository"),
      workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository")
    });
  });

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
