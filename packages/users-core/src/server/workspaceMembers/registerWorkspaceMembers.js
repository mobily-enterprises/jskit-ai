import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createService as createWorkspaceMembersService } from "./workspaceMembersService.js";
import { workspaceMembersActions } from "./workspaceMembersActions.js";

const USERS_WORKSPACE_MEMBERS_ACTION_DEFINITIONS_TOKEN = "users.core.workspaceMembers.actionDefinitions";
const USERS_WORKSPACE_MEMBERS_SERVICE_TOKEN = "users.workspace.members.service";

function registerWorkspaceMembers(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerWorkspaceMembers requires application singleton().");
  }

  app.singleton(USERS_WORKSPACE_MEMBERS_SERVICE_TOKEN, (scope) => {
    return createWorkspaceMembersService({
      workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository"),
      workspaceInvitesRepository: scope.make("workspaceInvitesRepository")
    });
  });

  registerActionDefinitions(app, USERS_WORKSPACE_MEMBERS_ACTION_DEFINITIONS_TOKEN, {
    contributorId: "users.workspace-members",
    domain: "workspace",
    dependencies: {
      workspaceMembersService: USERS_WORKSPACE_MEMBERS_SERVICE_TOKEN
    },
    actions: workspaceMembersActions
  });
}

export { registerWorkspaceMembers };
