import { registerBootstrapPayloadContributor } from "@jskit-ai/kernel/server/runtime";
import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { createWorkspaceBootstrapContributor } from "./workspaceBootstrapContributor.js";


function registerWorkspaceBootstrap(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerWorkspaceBootstrap requires application singleton().");
  }

  registerBootstrapPayloadContributor(app, "workspaces.core.bootstrap.payloadContributor", (scope) => {
    const workspaceInvitationsEnabled = scope.make("workspaces.invitations.enabled");

    return createWorkspaceBootstrapContributor({
      workspaceService: scope.make("workspaces.service"),
      workspacePendingInvitationsService: workspaceInvitationsEnabled
        ? scope.make("workspaces.pending-invitations.service")
        : null,
      workspaceInvitationsEnabled,
      userProfilesRepository: scope.make("internal.repository.user-profiles"),
      appConfig: resolveAppConfig(scope),
      tenancyProfile: scope.make("workspaces.tenancy.profile")
    });
  });
}

export { registerWorkspaceBootstrap };
