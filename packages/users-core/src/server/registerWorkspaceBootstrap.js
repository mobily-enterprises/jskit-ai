import { registerBootstrapPayloadContributor } from "@jskit-ai/kernel/server/runtime";
import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { createWorkspaceBootstrapContributor } from "./workspaceBootstrapContributor.js";


function registerWorkspaceBootstrap(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerWorkspaceBootstrap requires application singleton().");
  }

  registerBootstrapPayloadContributor(app, "workspaces.core.bootstrap.payloadContributor", (scope) => {
    const workspaceInvitationsEnabled = scope.make("users.workspace.invitations.enabled");

    return createWorkspaceBootstrapContributor({
      workspaceService: scope.make("users.workspace.service"),
      workspacePendingInvitationsService: workspaceInvitationsEnabled
        ? scope.make("users.workspace.pending-invitations.service")
        : null,
      workspaceInvitationsEnabled,
      usersRepository: scope.make("usersRepository"),
      appConfig: resolveAppConfig(scope),
      tenancyProfile: scope.make("users.tenancy.profile")
    });
  });
}

export { registerWorkspaceBootstrap };
