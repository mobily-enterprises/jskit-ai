import { registerBootstrapPayloadContributor } from "@jskit-ai/kernel/server/runtime";
import {
  USERS_TENANCY_PROFILE_TOKEN,
  USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN,
  USERS_WORKSPACE_TENANCY_ENABLED_TOKEN
} from "./common/diTokens.js";
import { createWorkspaceBootstrapContributor } from "./workspaceBootstrapContributor.js";

const USERS_WORKSPACE_BOOTSTRAP_PAYLOAD_CONTRIBUTOR_TOKEN = "users.core.workspace.bootstrap.payloadContributor";

function registerWorkspaceBootstrap(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerWorkspaceBootstrap requires application singleton().");
  }

  registerBootstrapPayloadContributor(app, USERS_WORKSPACE_BOOTSTRAP_PAYLOAD_CONTRIBUTOR_TOKEN, (scope) => {
    const workspaceTenancyEnabled = scope.make(USERS_WORKSPACE_TENANCY_ENABLED_TOKEN);

    return createWorkspaceBootstrapContributor({
      workspaceService: scope.make("users.workspace.service"),
      workspacePendingInvitationsService: workspaceTenancyEnabled
        ? scope.make(USERS_WORKSPACE_PENDING_INVITATIONS_SERVICE_TOKEN)
        : null,
      workspaceTenancyEnabled,
      userProfilesRepository: scope.make("userProfilesRepository"),
      userSettingsRepository: scope.make("userSettingsRepository"),
      appConfig: scope.has("appConfig") ? scope.make("appConfig") : {},
      tenancyProfile: scope.make(USERS_TENANCY_PROFILE_TOKEN),
      authService: scope.make("authService"),
      consoleService: scope.has("consoleService") ? scope.make("consoleService") : null
    });
  });
}

export { registerWorkspaceBootstrap };
