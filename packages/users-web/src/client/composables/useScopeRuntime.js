import { computed } from "vue";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { USERS_ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/users-core/shared/support/usersVisibility";
import { useAccess } from "./useAccess.js";
import { useWorkspaceRouteContext } from "./useWorkspaceRouteContext.js";
import { usePaths } from "./usePaths.js";
import { surfaceRequiresWorkspaceFromPlacementContext } from "../lib/workspaceSurfaceContext.js";
import {
  asPlainObject,
  ensureAccessModeCompatibility,
  resolveAccessModeEnabled,
  normalizeOwnershipFilter,
  resolveApiSuffix
} from "./support/scopeHelpers.js";

function useScopeRuntime({
  ownershipFilter = USERS_ROUTE_VISIBILITY_WORKSPACE,
  surfaceId = "",
  accessMode = "auto",
  hasPermissionRequirements = false,
  placementSource = "users-web.scope-runtime"
} = {}) {
  const normalizedOwnershipFilter = normalizeOwnershipFilter(ownershipFilter);
  const normalizedAccessMode = ensureAccessModeCompatibility({
    accessMode,
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
  const resolvedSurfaceId = computed(() => {
    const explicitSurfaceId = normalizeSurfaceId(surfaceId);
    if (explicitSurfaceId) {
      return explicitSurfaceId;
    }

    return normalizeSurfaceId(routeContext.currentSurfaceId.value);
  });
  const workspaceScoped = computed(() =>
    surfaceRequiresWorkspaceFromPlacementContext(routeContext.placementContext.value, resolvedSurfaceId.value)
  );
  const hasRouteWorkspaceSlug = computed(() => (workspaceScoped.value ? Boolean(workspaceSlugFromRoute.value) : true));
  const workspaceRouteError = computed(() => {
    if (!workspaceScoped.value || hasRouteWorkspaceSlug.value) {
      return "";
    }

    return `Route parameter workspaceSlug is required for surface "${resolvedSurfaceId.value || "<unknown>"}".`;
  });

  const accessRuntime = useAccess({
    workspaceSlug: computed(() => (workspaceScoped.value ? workspaceSlugFromRoute.value : "")),
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
      ownershipFilter: normalizedOwnershipFilter,
      ...asPlainObject(context)
    });

    return paths.api(suffix, {
      surface: resolvedSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value
    });
  }

  function requireWorkspaceRouteParam(caller = "useScopeRuntime") {
    if (workspaceRouteError.value) {
      throw new Error(`${caller}: ${workspaceRouteError.value}`);
    }
  }

  return Object.freeze({
    normalizedOwnershipFilter,
    workspaceScoped: workspaceScoped.value,
    resolvedSurfaceId,
    accessMode: normalizedAccessMode,
    accessRequired,
    routeContext,
    workspaceSlugFromRoute,
    hasRouteWorkspaceSlug,
    workspaceRouteError,
    access: accessRuntime,
    resolveApiPath,
    requireWorkspaceRouteParam
  });
}

export { useScopeRuntime };
