import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  registerActionContextContributor
} from "@jskit-ai/kernel/server/actions";
import { registerRouteVisibilityResolver } from "@jskit-ai/kernel/server/http";
import { TENANCY_MODE_WORKSPACE, normalizeTenancyMode } from "@jskit-ai/kernel/shared/surface";
import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import { createService as createWorkspaceService } from "./common/services/workspaceContextService.js";
import { createWorkspaceActionContextContributor } from "./common/contributors/workspaceActionContextContributor.js";
import { createWorkspaceRouteVisibilityResolver } from "./common/contributors/workspaceRouteVisibilityResolver.js";
import {
  USERS_WORKSPACE_TENANCY_ENABLED_TOKEN
} from "./common/diTokens.js";

const USERS_WORKSPACE_CONTEXT_CONTRIBUTOR_TOKEN = "users.core.workspace.actionContextContributor";
const USERS_WORKSPACE_VISIBILITY_RESOLVER_TOKEN = "users.core.workspace.routeVisibilityResolver";

function resolveWorkspaceTenancyEnabled(appConfig = {}) {
  return normalizeTenancyMode(appConfig.tenancyMode) === TENANCY_MODE_WORKSPACE;
}

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

  app.singleton(KERNEL_TOKENS.SurfaceRuntime, (scope) => {
    const appConfig = scope.has("appConfig") ? scope.make("appConfig") : {};
    return createSurfaceRuntime({
      tenancyMode: appConfig.tenancyMode,
      allMode: appConfig.surfaceModeAll,
      surfaces: appConfig.surfaceDefinitions,
      defaultSurfaceId: appConfig.surfaceDefaultId
    });
  });

  app.singleton(USERS_WORKSPACE_TENANCY_ENABLED_TOKEN, (scope) => {
    const appConfig = scope.make("appConfig");
    return resolveWorkspaceTenancyEnabled(appConfig);
  });

  registerActionContextContributor(app, USERS_WORKSPACE_CONTEXT_CONTRIBUTOR_TOKEN, (scope) => {
    return createWorkspaceActionContextContributor({
      workspaceService: scope.make("users.workspace.service")
    });
  });

  registerRouteVisibilityResolver(app, USERS_WORKSPACE_VISIBILITY_RESOLVER_TOKEN, (scope) =>
    createWorkspaceRouteVisibilityResolver({
      workspaceService: scope.make("users.workspace.service")
    })
  );
}

export { registerWorkspaceCore };
