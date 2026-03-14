import { computed } from "vue";
import { useAccess } from "./useAccess.js";
import { useWorkspaceRouteContext } from "./useWorkspaceRouteContext.js";
import { usePaths } from "./usePaths.js";
import {
  asPlainObject,
  ensureAccessModeCompatibility,
  resolveAccessModeEnabled,
  normalizeUsersVisibility,
  isWorkspaceVisibility,
  resolveApiSuffix
} from "./scopeHelpers.js";

function useScopeRuntime({
  visibility = "workspace",
  access = "auto",
  hasPermissionRequirements = false,
  placementSource = "users-web.scope-runtime"
} = {}) {
  const normalizedVisibility = normalizeUsersVisibility(visibility);
  const workspaceScoped = isWorkspaceVisibility(normalizedVisibility);
  const normalizedAccessMode = ensureAccessModeCompatibility({
    accessMode: access,
    hasPermissionRequirements,
    caller: "useScopeRuntime"
  });
  const accessRequired = resolveAccessModeEnabled(normalizedAccessMode, {
    hasPermissionRequirements
  });
  const routeContext = useWorkspaceRouteContext();
  const paths = usePaths({
    routeContext
  });

  const workspaceSlugFromRoute = routeContext.workspaceSlugFromRoute;
  const hasRouteWorkspaceSlug = computed(() => (workspaceScoped ? Boolean(workspaceSlugFromRoute.value) : true));
  const workspaceRouteError = computed(() => {
    if (!workspaceScoped || hasRouteWorkspaceSlug.value) {
      return "";
    }

    return "Route parameter workspaceSlug is required for workspace/workspace_user visibility.";
  });

  const access = useAccess({
    workspaceSlug: workspaceScoped ? workspaceSlugFromRoute : "",
    enabled: computed(() => accessRequired && hasRouteWorkspaceSlug.value),
    access: normalizedAccessMode,
    hasPermissionRequirements,
    mergePlacementContext: accessRequired ? routeContext.mergePlacementContext : null,
    placementSource: String(placementSource || "users-web.scope-runtime")
  });

  function resolveApiPath(apiSuffix = "", context = {}) {
    if (workspaceRouteError.value) {
      return "";
    }

    const suffix = resolveApiSuffix(apiSuffix, {
      surfaceId: routeContext.currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      visibility: normalizedVisibility,
      ...asPlainObject(context)
    });

    return paths.api(suffix, {
      visibility: normalizedVisibility,
      workspaceSlug: workspaceSlugFromRoute.value
    });
  }

  function requireWorkspaceRouteParam(caller = "useScopeRuntime") {
    if (workspaceRouteError.value) {
      throw new Error(`${caller}: ${workspaceRouteError.value}`);
    }
  }

  return Object.freeze({
    normalizedVisibility,
    workspaceScoped,
    accessMode: normalizedAccessMode,
    accessRequired,
    routeContext,
    workspaceSlugFromRoute,
    hasRouteWorkspaceSlug,
    workspaceRouteError,
    access,
    resolveApiPath,
    requireWorkspaceRouteParam
  });
}

export { useScopeRuntime };
