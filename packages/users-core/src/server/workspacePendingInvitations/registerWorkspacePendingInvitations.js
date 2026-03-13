import { createService } from "./workspacePendingInvitationsService.js";
import { workspacePendingInvitationsActions } from "./workspacePendingInvitationsActions.js";
import {
  USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN,
  USERS_WORKSPACE_TENANCY_ENABLED_TOKEN
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

  app.actions({
    contributorId: "users.workspace-pending-invitations",
    domain: "workspace",
    dependencies: {
      workspacePendingInvitationsService: USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN,
      workspaceTenancyEnabled: USERS_WORKSPACE_TENANCY_ENABLED_TOKEN
    },
    enabled: ({ deps }) => deps.workspaceTenancyEnabled === true,
    actions: workspacePendingInvitationsActions
  });
}

export { registerWorkspacePendingInvitations };
