import {
  registerActionContextContributor
} from "@jskit-ai/kernel/server/actions";
import { registerRouteVisibilityResolver } from "@jskit-ai/kernel/server/http";
import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { registerProfileSyncLifecycleContributor } from "@jskit-ai/users-core/server/profileSyncLifecycleContributorRegistry";
import { createService as createWorkspaceService } from "./common/services/workspaceContextService.js";
import { createWorkspaceActionContextContributor } from "./common/contributors/workspaceActionContextContributor.js";
import { createWorkspaceRouteVisibilityResolver } from "./common/contributors/workspaceRouteVisibilityResolver.js";
import { createWorkspaceAuthPolicyContextResolver } from "./common/contributors/workspaceAuthPolicyContextResolver.js";
import { TENANCY_MODE_WORKSPACES, resolveTenancyProfile } from "../shared/tenancyProfile.js";
import { resolveWorkspaceInvitationsPolicy } from "./support/workspaceInvitationsPolicy.js";
import {
  registerWorkspaceActionSurfaceSources,
  resolveWorkspaceSurfaceIdsFromAppConfig
} from "./support/workspaceActionSurfaces.js";


function registerWorkspaceCore(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerWorkspaceCore requires application singleton().");
  }

  registerWorkspaceActionSurfaceSources(app);

  app.singleton("workspaces.tenancy.profile", (scope) => {
    const appConfig = resolveAppConfig(scope);
    return resolveTenancyProfile(appConfig);
  });

  app.singleton("workspaces.service", (scope) => {
    const appConfig = resolveAppConfig(scope);
    return createWorkspaceService({
      appConfig,
      workspacesRepository: scope.make("workspacesRepository"),
      workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository"),
      workspaceSettingsRepository: scope.make("workspaceSettingsRepository")
    });
  });
  app.singleton("workspaces.enabled", (scope) => {
    return scope.make("workspaces.tenancy.profile").workspace.enabled === true;
  });

  app.singleton("workspaces.self-create.enabled", (scope) => {
    return scope.make("workspaces.tenancy.profile").workspace.allowSelfCreate === true;
  });

  app.singleton("workspaces.tenancy.enabled", (scope) => {
    return scope.make("workspaces.tenancy.profile").mode === TENANCY_MODE_WORKSPACES;
  });

  app.singleton("workspaces.invitations.enabled", (scope) => {
    const appConfig = resolveAppConfig(scope);
    const tenancyProfile = scope.make("workspaces.tenancy.profile");
    return resolveWorkspaceInvitationsPolicy({
      appConfig,
      tenancyProfile
    }).enabled;
  });

  registerProfileSyncLifecycleContributor(app, "workspaces.core.profileSyncLifecycleContributor", (scope) => {
    const workspaceService = scope.make("workspaces.service");

    return Object.freeze({
      contributorId: "workspaces.core.profileSync",
      order: 100,
      async afterIdentityProfileSynced({ profile, created, options } = {}) {
        if (!created || !profile || typeof workspaceService?.provisionWorkspaceForNewUser !== "function") {
          return;
        }

        await workspaceService.provisionWorkspaceForNewUser(profile, options);
      }
    });
  });

  registerActionContextContributor(app, "users.core.workspace.actionContextContributor", (scope) => {
    const appConfig = resolveAppConfig(scope);
    return createWorkspaceActionContextContributor({
      workspaceService: scope.make("workspaces.service"),
      workspaceSurfaceIds: resolveWorkspaceSurfaceIdsFromAppConfig(appConfig)
    });
  });

  if (typeof app.has !== "function" || !app.has("auth.policy.contextResolver")) {
    app.singleton("auth.policy.contextResolver", (scope) =>
      createWorkspaceAuthPolicyContextResolver({
        workspaceService: scope.make("workspaces.service")
      })
    );
  }

  registerRouteVisibilityResolver(app, "users.core.workspace.routeVisibilityResolver", (scope) =>
    createWorkspaceRouteVisibilityResolver({
      workspaceService: scope.make("workspaces.service")
    })
  );
}

export { registerWorkspaceCore };
