import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createService as createWorkspaceMembersService } from "./workspaceMembersService.js";
import { workspaceMembersActions } from "./workspaceMembersActions.js";

const USERS_WORKSPACE_MEMBERS_ACTION_DEFINITIONS_TOKEN = "users.core.workspaceMembers.actionDefinitions";
const USERS_WORKSPACE_MEMBERS_SERVICE_TOKEN = "users.workspace.members.service";

function resolveWorkspaceMembersInviteExpiresInMs(appConfig = {}) {
  const inviteExpiresInMs = Number(appConfig?.workspaceMembers?.defaults?.inviteExpiresInMs);
  if (!Number.isInteger(inviteExpiresInMs) || inviteExpiresInMs < 1) {
    throw new TypeError("users.core requires appConfig.workspaceMembers.defaults.inviteExpiresInMs.");
  }

  return inviteExpiresInMs;
}

function registerWorkspaceMembers(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerWorkspaceMembers requires application singleton().");
  }

  app.singleton(USERS_WORKSPACE_MEMBERS_SERVICE_TOKEN, (scope) => {
    const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
    return createWorkspaceMembersService({
      workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository"),
      workspaceInvitesRepository: scope.make("workspaceInvitesRepository"),
      inviteExpiresInMs: resolveWorkspaceMembersInviteExpiresInMs(appConfig)
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
