import { computed } from "vue";
import { useUsersWebAccess } from "./useUsersWebAccess.js";
import { useUsersWebWorkspaceRouteContext } from "./useUsersWebWorkspaceRouteContext.js";
import { useUsersPaths } from "./useUsersPaths.js";
import {
  asPlainObject,
  normalizeUsersVisibility,
  isWorkspaceVisibility,
  resolveApiSuffix
} from "./scopeHelpers.js";

function useUsersWebScopeRuntime({
  visibility = "workspace",
  placementSource = "users-web.scope-runtime"
} = {}) {
  const normalizedVisibility = normalizeUsersVisibility(visibility);
  const workspaceScoped = isWorkspaceVisibility(normalizedVisibility);
  const routeContext = useUsersWebWorkspaceRouteContext();
  const usersPaths = useUsersPaths({
    routeContext
  });

  const workspaceSlugFromRoute = routeContext.workspaceSlugFromRoute;
  const hasRouteWorkspaceSlug = computed(() => (workspaceScoped ? Boolean(workspaceSlugFromRoute.value) : true));

  const access = useUsersWebAccess({
    workspaceSlug: workspaceScoped ? workspaceSlugFromRoute : "",
    enabled: hasRouteWorkspaceSlug,
    mergePlacementContext: routeContext.mergePlacementContext,
    placementSource: String(placementSource || "users-web.scope-runtime")
  });

  function resolveApiPath(apiSuffix = "", context = {}) {
    const suffix = resolveApiSuffix(apiSuffix, {
      surfaceId: routeContext.currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      visibility: normalizedVisibility,
      ...asPlainObject(context)
    });

    return usersPaths.api(suffix, {
      visibility: normalizedVisibility,
      workspaceSlug: workspaceSlugFromRoute.value
    });
  }

  function requireWorkspaceRouteParam(caller = "useUsersWebScopeRuntime") {
    if (workspaceScoped && !hasRouteWorkspaceSlug.value) {
      throw new Error(`${caller} requires route.params.workspaceSlug when visibility is workspace/workspace_user.`);
    }
  }

  return Object.freeze({
    normalizedVisibility,
    workspaceScoped,
    routeContext,
    workspaceSlugFromRoute,
    hasRouteWorkspaceSlug,
    access,
    resolveApiPath,
    requireWorkspaceRouteParam
  });
}

export { useUsersWebScopeRuntime };
