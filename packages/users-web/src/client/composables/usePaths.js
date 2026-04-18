import { computed, unref } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { resolveSurfaceDefinitionFromPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { useShellLinkResolver } from "@jskit-ai/shell-web/client/navigation/linkResolver";
import { useSurfaceRouteContext } from "./useSurfaceRouteContext.js";

function normalizePathSuffix(value = "") {
  const raw = normalizeText(unref(value));
  if (!raw) {
    return "";
  }

  return raw.startsWith("/") ? raw : `/${raw}`;
}

function resolveSurfaceId(value, fallback = "") {
  const normalized = normalizeText(unref(value)).toLowerCase();
  if (normalized && normalized !== "*") {
    return normalized;
  }

  const normalizedFallback = normalizeText(unref(fallback)).toLowerCase();
  if (normalizedFallback && normalizedFallback !== "*") {
    return normalizedFallback;
  }

  return "";
}

function resolveDefaultSurfaceIdFromPlacementContext(placementContext = null) {
  return resolveSurfaceId(placementContext?.surfaceConfig?.defaultSurfaceId, "");
}

function normalizeRouteParams(params = null) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return {};
  }

  const output = {};
  for (const [rawKey, rawValue] of Object.entries(params)) {
    const key = normalizeText(rawKey);
    if (!key) {
      continue;
    }

    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) {
      continue;
    }
    output[key] = normalizedValue;
  }
  return output;
}

function resolveRouteParams(baseParams = {}, overrideParams = null) {
  return {
    ...normalizeRouteParams(baseParams),
    ...normalizeRouteParams(overrideParams)
  };
}

function usePaths({ routeContext: sourceRouteContext = null } = {}) {
  const routeContext = sourceRouteContext || useSurfaceRouteContext();
  const shellLinkResolver = useShellLinkResolver();
  const routeParams = computed(() => normalizeRouteParams(routeContext.route?.params));

  function page(relativePath = "/", options = {}) {
    const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
    const surface =
      resolveSurfaceId(source.surface, routeContext.currentSurfaceId.value) ||
      resolveDefaultSurfaceIdFromPlacementContext(routeContext.placementContext.value);
    if (!surface) {
      return "";
    }
    return shellLinkResolver.resolve(relativePath, {
      surface,
      explicitTo: source.explicitTo,
      surfaceRelativePath: source.surfaceRelativePath,
      params: resolveRouteParams(routeParams.value, source.params),
      strictParams: source.strictParams !== false
    });
  }

  function api(relativePath = "", options = {}) {
    const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
    const surface =
      resolveSurfaceId(source.surface, routeContext.currentSurfaceId.value) ||
      resolveDefaultSurfaceIdFromPlacementContext(routeContext.placementContext.value);
    const suffix = normalizePathSuffix(relativePath);

    if (!suffix) {
      throw new TypeError("usePaths().api(relativePath) requires a non-empty relativePath.");
    }

    const routeBase = resolveSurfaceDefinitionFromPlacementContext(
      routeContext.placementContext.value,
      surface
    )?.routeBase || "/";

    return resolveScopedApiBasePath({
      routeBase,
      relativePath: suffix,
      params: resolveRouteParams(routeParams.value, source.params),
      strictParams: source.strictParams !== false
    });
  }

  return Object.freeze({
    route: routeContext.route,
    placementContext: routeContext.placementContext,
    currentSurfaceId: routeContext.currentSurfaceId,
    routeParams,
    page,
    api
  });
}

export { usePaths };
