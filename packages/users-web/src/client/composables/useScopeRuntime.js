import { computed } from "vue";
import { normalizeSurfaceId, resolveScopedRouteBase } from "@jskit-ai/kernel/shared/surface";
import {
  ROUTE_VISIBILITY_WORKSPACE
} from "@jskit-ai/kernel/shared/support/visibility";
import { useAccess } from "./useAccess.js";
import { useSurfaceRouteContext } from "./useSurfaceRouteContext.js";
import { usePaths } from "./usePaths.js";
import { resolveSurfaceDefinitionFromPlacementContext } from "@jskit-ai/shell-web/client/placement";
import {
  asPlainObject,
  ensureAccessModeCompatibility,
  resolveAccessModeEnabled,
  normalizeOwnershipFilter,
  resolveApiSuffix
} from "./support/scopeHelpers.js";
import { extractRouteParamNames, toRouteParamValue } from "./support/routeTemplateHelpers.js";

function resolveScopedRouteParamNames(placementContext = null, surfaceId = "") {
  const routeBase = resolveSurfaceDefinitionFromPlacementContext(placementContext, surfaceId)?.routeBase || "/";
  return extractRouteParamNames(resolveScopedRouteBase(routeBase));
}

function useScopeRuntime({
  ownershipFilter = ROUTE_VISIBILITY_WORKSPACE,
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
  const routeContext = useSurfaceRouteContext();
  const paths = usePaths({
    routeContext
  });

  const resolvedSurfaceId = computed(() => {
    const explicitSurfaceId = normalizeSurfaceId(surfaceId);
    if (explicitSurfaceId) {
      return explicitSurfaceId;
    }

    return normalizeSurfaceId(routeContext.currentSurfaceId.value);
  });
  const scopedRouteParamNames = computed(() =>
    resolveScopedRouteParamNames(routeContext.placementContext.value, resolvedSurfaceId.value)
  );
  const routeScopeParams = computed(() => {
    const source = paths.routeParams.value;
    const next = {};
    for (const paramName of scopedRouteParamNames.value) {
      const paramValue = toRouteParamValue(source[paramName]);
      if (paramValue) {
        next[paramName] = paramValue;
      }
    }
    return Object.freeze(next);
  });
  const missingScopedRouteParamNames = computed(() =>
    scopedRouteParamNames.value.filter((paramName) => !routeScopeParams.value[paramName])
  );
  const requiresScopedRouteParams = computed(() => scopedRouteParamNames.value.length > 0);
  const hasRequiredRouteScope = computed(() => missingScopedRouteParamNames.value.length < 1);
  const scopeParamValue = computed(() => {
    const [primaryScopeParamName = ""] = scopedRouteParamNames.value;
    return primaryScopeParamName ? routeScopeParams.value[primaryScopeParamName] || "" : "";
  });
  const routeScopeError = computed(() => {
    if (!requiresScopedRouteParams.value || hasRequiredRouteScope.value) {
      return "";
    }

    const missingParams = missingScopedRouteParamNames.value.join(", ");
    return `Route parameters ${missingParams} are required for surface "${resolvedSurfaceId.value || "<unknown>"}".`;
  });

  const accessRuntime = useAccess({
    scopeParamValue,
    enabled: computed(() => accessRequired && hasRequiredRouteScope.value),
    access: normalizedAccessMode,
    hasPermissionRequirements,
    placementSource: String(placementSource || "users-web.scope-runtime")
  });

  function resolveApiPath(apiSuffix = "", context = {}) {
    if (routeScopeError.value) {
      return "";
    }

    const suffix = resolveApiSuffix(apiSuffix, {
      surfaceId: routeContext.currentSurfaceId.value,
      scopeParamValue: scopeParamValue.value,
      ownershipFilter: normalizedOwnershipFilter,
      ...asPlainObject(context)
    });

    return paths.api(suffix, {
      surface: resolvedSurfaceId.value,
      params: routeScopeParams.value
    });
  }

  function requireRouteScope(caller = "useScopeRuntime") {
    if (routeScopeError.value) {
      throw new Error(`${caller}: ${routeScopeError.value}`);
    }
  }

  return Object.freeze({
    normalizedOwnershipFilter,
    requiresScopedRouteParams: requiresScopedRouteParams.value,
    resolvedSurfaceId,
    accessMode: normalizedAccessMode,
    accessRequired,
    routeContext,
    scopedRouteParamNames,
    routeScopeParams,
    scopeParamValue,
    hasRequiredRouteScope,
    routeScopeError,
    access: accessRuntime,
    resolveApiPath,
    requireRouteScope
  });
}

export { useScopeRuntime };
