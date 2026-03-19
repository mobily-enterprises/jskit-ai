import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { AUTH_POLICY_CONTEXT_RESOLVER_TOKEN } from "@jskit-ai/auth-core/server/lib/tokens";
import {
  registerActionContextContributor
} from "@jskit-ai/kernel/server/actions";
import { registerRouteVisibilityResolver } from "@jskit-ai/kernel/server/http";
import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import { TENANCY_MODE_WORKSPACE, resolveTenancyProfile } from "../shared/tenancyProfile.js";
import { createService as createWorkspaceService } from "./common/services/workspaceContextService.js";
import { createService as createAuthProfileSyncService } from "./common/services/authProfileSyncService.js";
import { createWorkspaceActionContextContributor } from "./common/contributors/workspaceActionContextContributor.js";
import { createWorkspaceRouteVisibilityResolver } from "./common/contributors/workspaceRouteVisibilityResolver.js";
import { createWorkspaceAuthPolicyContextResolver } from "./common/contributors/workspaceAuthPolicyContextResolver.js";
import {
  USERS_PROFILE_SYNC_SERVICE_TOKEN,
  USERS_TENANCY_PROFILE_TOKEN,
  USERS_WORKSPACE_ENABLED_TOKEN,
  USERS_WORKSPACE_SELF_CREATE_ENABLED_TOKEN,
  USERS_WORKSPACE_TENANCY_ENABLED_TOKEN
} from "./common/diTokens.js";

const USERS_WORKSPACE_CONTEXT_CONTRIBUTOR_TOKEN = "users.core.workspace.actionContextContributor";
const USERS_WORKSPACE_VISIBILITY_RESOLVER_TOKEN = "users.core.workspace.routeVisibilityResolver";

function registerWorkspaceCore(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerWorkspaceCore requires application singleton().");
  }

  app.singleton("users.workspace.service", (scope) => {
    const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
    return createWorkspaceService({
      appConfig,
      workspacesRepository: scope.make("workspacesRepository"),
      workspaceMembershipsRepository: scope.make("workspaceMembershipsRepository"),
      workspaceSettingsRepository: scope.make("workspaceSettingsRepository")
    });
  });

  app.singleton(USERS_PROFILE_SYNC_SERVICE_TOKEN, (scope) => {
    return createAuthProfileSyncService({
      userProfilesRepository: scope.make("userProfilesRepository"),
      workspaceProvisioningService: scope.make("users.workspace.service")
    });
  });

  app.singleton(KERNEL_TOKENS.SurfaceRuntime, (scope) => {
    const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
    return createSurfaceRuntime({
      allMode: appConfig.surfaceModeAll,
      surfaces: appConfig.surfaceDefinitions,
      defaultSurfaceId: appConfig.surfaceDefaultId
    });
  });

  app.singleton(USERS_TENANCY_PROFILE_TOKEN, (scope) => {
    const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
    return resolveTenancyProfile(appConfig);
  });

  app.singleton(USERS_WORKSPACE_ENABLED_TOKEN, (scope) => {
    return scope.make(USERS_TENANCY_PROFILE_TOKEN).workspace.enabled === true;
  });

  app.singleton(USERS_WORKSPACE_SELF_CREATE_ENABLED_TOKEN, (scope) => {
    return scope.make(USERS_TENANCY_PROFILE_TOKEN).workspace.allowSelfCreate === true;
  });

  app.singleton(USERS_WORKSPACE_TENANCY_ENABLED_TOKEN, (scope) => {
    return scope.make(USERS_TENANCY_PROFILE_TOKEN).mode === TENANCY_MODE_WORKSPACE;
  });

  registerActionContextContributor(app, USERS_WORKSPACE_CONTEXT_CONTRIBUTOR_TOKEN, (scope) => {
    return createWorkspaceActionContextContributor({
      workspaceService: scope.make("users.workspace.service")
    });
  });

  if (typeof app.has !== "function" || !app.has(AUTH_POLICY_CONTEXT_RESOLVER_TOKEN)) {
    app.singleton(AUTH_POLICY_CONTEXT_RESOLVER_TOKEN, (scope) =>
      createWorkspaceAuthPolicyContextResolver({
        workspaceService: scope.make("users.workspace.service")
      })
    );
  }

  registerRouteVisibilityResolver(app, USERS_WORKSPACE_VISIBILITY_RESOLVER_TOKEN, (scope) =>
    createWorkspaceRouteVisibilityResolver({
      workspaceService: scope.make("users.workspace.service")
    })
  );
}

export { registerWorkspaceCore };
