import { computed, unref } from "vue";
import { useScopeRuntime } from "../useScopeRuntime.js";
import { useOperationRealtime } from "../useRealtimeQueryInvalidation.js";
import {
  normalizePermissions,
  resolvePermissionAccess,
  resolveEnabled,
  resolveQueryKey
} from "../scopeHelpers.js";

function normalizePermissionSets(permissionSets = {}) {
  const source = permissionSets && typeof permissionSets === "object" && !Array.isArray(permissionSets)
    ? permissionSets
    : {};
  const normalized = {};

  for (const [key, value] of Object.entries(source)) {
    normalized[key] = normalizePermissions(value);
  }

  return normalized;
}

function hasAnyPermissions(permissionSets = {}) {
  for (const list of Object.values(permissionSets)) {
    if (Array.isArray(list) && list.length > 0) {
      return true;
    }
  }

  return false;
}

function useOperationScope({
  ownershipFilter = "workspace",
  surfaceId = "",
  access = "auto",
  placementSource = "users-web.operation",
  apiSuffix = "",
  model,
  readEnabled = true,
  queryKeyFactory = null,
  permissionSets = {},
  realtime = null
} = {}) {
  const normalizedPermissionSets = normalizePermissionSets(permissionSets);
  const scopeRuntime = useScopeRuntime({
    ownershipFilter,
    surfaceId,
    accessMode: access,
    hasPermissionRequirements: hasAnyPermissions(normalizedPermissionSets),
    placementSource
  });
  const normalizedOwnershipFilter = scopeRuntime.normalizedOwnershipFilter;
  const routeContext = scopeRuntime.routeContext;
  const workspaceSlugFromRoute = scopeRuntime.workspaceSlugFromRoute;
  const hasRouteWorkspaceSlug = scopeRuntime.hasRouteWorkspaceSlug;
  const accessRuntime = scopeRuntime.access;

  const apiPath = computed(() =>
    scopeRuntime.resolveApiPath(apiSuffix, {
      model
    })
  );

  const queryEnabled = computed(() =>
    resolveEnabled(readEnabled, {
      surfaceId: routeContext.currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      ownershipFilter: normalizedOwnershipFilter,
      model
    })
  );

  const queryKey = computed(() =>
    resolveQueryKey(queryKeyFactory, {
      surfaceId: routeContext.currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      ownershipFilter: normalizedOwnershipFilter
    })
  );
  const realtimeBinding = useOperationRealtime({
    realtime,
    queryKey: typeof queryKeyFactory === "function" ? queryKey : null,
    enabled: computed(() => hasRouteWorkspaceSlug.value && Boolean(apiPath.value))
  });

  function queryCanRun(accessGate = true) {
    return computed(() =>
      queryEnabled.value &&
      hasRouteWorkspaceSlug.value &&
      Boolean(apiPath.value) &&
      Boolean(unref(accessGate))
    );
  }

  function permissionGate(key = "") {
    const list = normalizedPermissionSets[String(key || "")] || [];
    return computed(() => resolvePermissionAccess(accessRuntime, list));
  }

  function loadError(baseError = "") {
    return computed(() => {
      if (scopeRuntime.workspaceRouteError.value) {
        return scopeRuntime.workspaceRouteError.value;
      }

      const bootstrapError = String(accessRuntime.bootstrapError.value || "").trim();
      if (bootstrapError) {
        return bootstrapError;
      }

      if (baseError === undefined || baseError === null || baseError === "") {
        return "";
      }

      return String(unref(baseError) || "").trim();
    });
  }

  function isLoading(baseLoading = false) {
    return computed(() => Boolean(unref(baseLoading)) || accessRuntime.isBootstrapping.value);
  }

  return Object.freeze({
    scopeRuntime,
    routeContext,
    normalizedOwnershipFilter,
    workspaceSlugFromRoute,
    hasRouteWorkspaceSlug,
    access: accessRuntime,
    apiPath,
    queryEnabled,
    queryKey,
    queryCanRun,
    realtime: realtimeBinding,
    permissionGate,
    loadError,
    isLoading
  });
}

export { useOperationScope };
