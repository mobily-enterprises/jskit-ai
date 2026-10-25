import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveShellLinkPath } from "../navigation/linkResolver.js";
import {
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "../placement/surfaceContext.js";

function normalizeMenuLinkPathname(pathname = "") {
  const source = String(pathname || "").trim();
  if (!source) {
    return "";
  }

  const queryIndex = source.indexOf("?");
  const hashIndex = source.indexOf("#");
  const cutoff =
    queryIndex < 0
      ? hashIndex
      : hashIndex < 0
        ? queryIndex
        : Math.min(queryIndex, hashIndex);

  return cutoff < 0 ? source : source.slice(0, cutoff);
}

function resolveMenuLinkSurfaceId(surface = "", fallbackSurfaceId = "") {
  const explicitSurface = normalizeText(surface).toLowerCase();
  if (explicitSurface && explicitSurface !== "*") {
    return explicitSurface;
  }

  return normalizeText(fallbackSurfaceId).toLowerCase();
}

function interpolateBracketParams(pathTemplate = "", params = {}) {
  const source = String(pathTemplate || "").trim();
  if (!source) {
    return "";
  }

  return source.replace(/\[([^\]]+)\]/g, (_match, rawKey) => {
    const key = String(rawKey || "").trim();
    if (!key) {
      return "";
    }

    const value = params?.[key];
    return value == null ? `[${key}]` : encodeURIComponent(String(value));
  });
}

function isRelativeMenuLinkTarget(target = "") {
  const normalizedTarget = normalizeText(target);
  return normalizedTarget.startsWith("./") || normalizedTarget.startsWith("../");
}

function surfaceRequiresWorkspaceFromPlacementContext(contextValue = null, surfaceId = "") {
  return Boolean(resolveSurfaceDefinitionFromPlacementContext(contextValue, surfaceId)?.requiresWorkspace);
}

function resolveMenuLinkTarget({
  to = "",
  surface = "",
  currentSurfaceId = "",
  placementContext = null,
  scopedSuffix = "/",
  unscopedSuffix = "/",
  routeParams = {}
} = {}) {
  const explicitTarget = normalizeText(to);
  const targetSurfaceId = resolveMenuLinkSurfaceId(surface, currentSurfaceId);
  const scopedRouteRequired = surfaceRequiresWorkspaceFromPlacementContext(placementContext, targetSurfaceId);
  const suffixTemplate = normalizeText(scopedRouteRequired ? scopedSuffix : unscopedSuffix) || "/";
  const interpolatedSuffix = interpolateBracketParams(suffixTemplate, routeParams);
  const resolvedSuffixTarget =
    targetSurfaceId &&
    interpolatedSuffix &&
    !interpolatedSuffix.includes("[")
      ? normalizeText(resolveShellLinkPath({
          context: placementContext,
          surface: targetSurfaceId,
          relativePath: interpolatedSuffix,
          params: routeParams,
          strictParams: true
        }))
      : "";

  if (!explicitTarget) {
    return resolvedSuffixTarget;
  }

  if (isRelativeMenuLinkTarget(explicitTarget)) {
    return resolvedSuffixTarget;
  }

  return explicitTarget;
}

// Menu and tab links render nothing for an empty target.
function resolveMenuLinkHref(placementContext = null, target = "") {
  const path = String(target || "").trim();
  if (!path) {
    return {
      href: "",
      sameOrigin: true
    };
  }

  const navigationTarget = resolveSurfaceNavigationTargetFromPlacementContext(placementContext, { path });
  return {
    href: navigationTarget.href,
    sameOrigin: navigationTarget.sameOrigin
  };
}

export {
  normalizeMenuLinkPathname,
  resolveMenuLinkHref,
  resolveMenuLinkTarget
};
