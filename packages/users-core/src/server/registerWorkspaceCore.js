import {
  registerActionContextContributor
} from "@jskit-ai/kernel/server/actions";
import { registerRouteVisibilityResolver } from "@jskit-ai/kernel/server/http";
import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { TENANCY_MODE_WORKSPACES, resolveTenancyProfile } from "../shared/tenancyProfile.js";
import { createService as createWorkspaceService } from "./common/services/workspaceContextService.js";
import { createService as createAuthProfileSyncService } from "./common/services/authProfileSyncService.js";
import { createWorkspaceActionContextContributor } from "./common/contributors/workspaceActionContextContributor.js";
import { createWorkspaceRouteVisibilityResolver } from "./common/contributors/workspaceRouteVisibilityResolver.js";
import { createWorkspaceAuthPolicyContextResolver } from "./common/contributors/workspaceAuthPolicyContextResolver.js";
import { resolveWorkspaceInvitationsPolicy } from "./support/workspaceInvitationsPolicy.js";
import { resolveWorkspaceSurfaceIdsFromAppConfig } from "./support/workspaceActionSurfaces.js";


function registerWorkspaceCore(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerWorkspaceCore requires application singleton().");
  }

  app.singleton("users.workspace.service", (scope) => {
    const appConfig = resolveAppConfig(scope);
    return createWorkspaceService({
      appConfig,
      workspacesRepository: scope.make("workspacesRepository"),
      workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository"),
      workspaceSettingsRepository: scope.make("workspaceSettingsRepository")
    });
  });

  app.singleton("users.profile.sync.service", (scope) => {
    return createAuthProfileSyncService({
      usersRepository: scope.make("usersRepository"),
      userSettingsRepository: scope.make("userSettingsRepository"),
      workspaceProvisioningService: scope.make("users.workspace.service")
    });
  });

  app.singleton("users.tenancy.profile", (scope) => {
    const appConfig = resolveAppConfig(scope);
    return resolveTenancyProfile(appConfig);
  });

  app.singleton("users.workspace.enabled", (scope) => {
    return scope.make("users.tenancy.profile").workspace.enabled === true;
  });

  app.singleton("users.workspace.self-create.enabled", (scope) => {
    return scope.make("users.tenancy.profile").workspace.allowSelfCreate === true;
  });

  app.singleton("users.workspace.tenancy.enabled", (scope) => {
    return scope.make("users.tenancy.profile").mode === TENANCY_MODE_WORKSPACES;
  });

  app.singleton("users.workspace.invitations.enabled", (scope) => {
    const appConfig = resolveAppConfig(scope);
    const tenancyProfile = scope.make("users.tenancy.profile");
    return resolveWorkspaceInvitationsPolicy({
      appConfig,
      tenancyProfile
    }).enabled;
  });

  registerActionContextContributor(app, "users.core.workspace.actionContextContributor", (scope) => {
    const appConfig = resolveAppConfig(scope);
    return createWorkspaceActionContextContributor({
      workspaceService: scope.make("users.workspace.service"),
      workspaceSurfaceIds: resolveWorkspaceSurfaceIdsFromAppConfig(appConfig)
    });
  });

  if (typeof app.has !== "function" || !app.has("auth.policy.contextResolver")) {
    app.singleton("auth.policy.contextResolver", (scope) =>
      createWorkspaceAuthPolicyContextResolver({
        workspaceService: scope.make("users.workspace.service")
      })
    );
  }

  registerRouteVisibilityResolver(app, "users.core.workspace.routeVisibilityResolver", (scope) =>
    createWorkspaceRouteVisibilityResolver({
      workspaceService: scope.make("users.workspace.service")
    })
  );
}

export { registerWorkspaceCore };
