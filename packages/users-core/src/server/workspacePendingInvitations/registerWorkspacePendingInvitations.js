import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import {
  USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN,
  USERS_WORKSPACE_TENANCY_ENABLED_TOKEN
} from "../common/diTokens.js";

const USERS_WORKSPACE_PENDING_INVITATIONS_ACTION_DEFINITIONS_TOKEN =
  "users.core.workspacePendingInvitations.actionDefinitions";

function registerWorkspacePendingInvitations(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerWorkspacePendingInvitations requires application singleton().");
  }

  app.singleton(USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN, (scope) => {
    return createService({
      workspaceInvitesRepository: scope.make("workspaceInvitesRepository"),
      workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository")
    });
  });

  registerActionDefinitions(app, USERS_WORKSPACE_PENDING_INVITATIONS_ACTION_DEFINITIONS_TOKEN, {
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

import { createService } from "./workspacePendingInvitationsService.js";
import { workspacePendingInvitationsActions } from "./workspacePendingInvitationsActions.js";

export { registerWorkspacePendingInvitations };
