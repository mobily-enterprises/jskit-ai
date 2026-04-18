import { computed, unref } from "vue";
import { ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/kernel/shared/support/visibility";
import { useScopeRuntime } from "../useScopeRuntime.js";
import { useOperationRealtime } from "../useRealtimeQueryInvalidation.js";
import {
  normalizePermissions,
  resolvePermissionAccess,
  resolveEnabled,
  resolveQueryKey
} from "../support/scopeHelpers.js";

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
  ownershipFilter = ROUTE_VISIBILITY_WORKSPACE,
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
  const scopeParamValue = scopeRuntime.scopeParamValue;
  const hasRequiredRouteScope = scopeRuntime.hasRequiredRouteScope;
  const accessRuntime = scopeRuntime.access;

  const apiPath = computed(() =>
    scopeRuntime.resolveApiPath(apiSuffix, {
      model
    })
  );

  const queryEnabled = computed(() =>
    resolveEnabled(readEnabled, {
      surfaceId: routeContext.currentSurfaceId.value,
      scopeParamValue: scopeParamValue.value,
      ownershipFilter: normalizedOwnershipFilter,
      model
    })
  );

  const queryKey = computed(() =>
    resolveQueryKey(queryKeyFactory, {
      surfaceId: routeContext.currentSurfaceId.value,
      scopeParamValue: scopeParamValue.value,
      ownershipFilter: normalizedOwnershipFilter
    })
  );
  const realtimeBinding = useOperationRealtime({
    realtime,
    queryKey: typeof queryKeyFactory === "function" ? queryKey : null,
    enabled: computed(() => hasRequiredRouteScope.value && Boolean(apiPath.value))
  });

  function queryCanRun(accessGate = true) {
    return computed(() =>
      queryEnabled.value &&
      hasRequiredRouteScope.value &&
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
      if (scopeRuntime.routeScopeError.value) {
        return scopeRuntime.routeScopeError.value;
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
    scopeParamValue,
    hasRequiredRouteScope,
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
