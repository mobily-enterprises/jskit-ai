import { unref } from "vue";
import { resolveLinkPath, normalizePathname } from "@jskit-ai/kernel/shared";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { useWebPlacementContext } from "../placement/inject.js";
import {
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceRootPathFromPlacementContext
} from "../placement/surfaceContext.js";
import { normalizeRouteParams } from "../support/routeParams.js";

function materializeSurfaceRouteBase(routeBaseTemplate = "/", { params = {}, strictParams = true, surface = "" } = {}) {
  const normalizedParams = normalizeRouteParams(params);
  const missingParams = new Set();
  const outputPath = String(routeBaseTemplate || "/").replace(/:([A-Za-z0-9_]+)/g, (_full, rawName) => {
    const paramName = String(rawName || "").trim();
    const paramValue = normalizedParams[paramName];
    if (!paramValue) {
      missingParams.add(paramName);
      return `:${paramName}`;
    }
    return encodeURIComponent(paramValue);
  });

  if (strictParams && missingParams.size > 0) {
    const surfaceLabel = String(surface || "").trim() || "(default)";
    const missing = [...missingParams].sort().join(", ");
    throw new Error(`Missing required surface route params for "${surfaceLabel}": ${missing}.`);
  }

  return outputPath;
}

function resolveSurfaceBasePath(context = null, surface = "", { params = {}, strictParams = true } = {}) {
  const normalizedSurface = normalizeSurfaceId(surface);
  if (normalizedSurface && resolveSurfaceDefinitionFromPlacementContext(context, normalizedSurface)) {
    const routeBaseTemplate = resolveSurfaceRootPathFromPlacementContext(context, normalizedSurface);
    return materializeSurfaceRouteBase(routeBaseTemplate, {
      params,
      strictParams,
      surface: normalizedSurface
    });
  }

  if (!normalizedSurface) {
    return "/";
  }

  return normalizePathname(`/${normalizedSurface}`);
}

function resolveShellLinkPath({
  context = null,
  surface = "",
  explicitTo = "",
  relativePath = "/",
  surfaceRelativePath = "",
  params = {},
  strictParams = true
} = {}) {
  const explicitTarget = String(explicitTo || "").trim();
  if (explicitTarget) {
    return explicitTarget;
  }

  const normalizedSurface = normalizeSurfaceId(surface);
  const nextRelativePath = String(surfaceRelativePath || "").trim() || String(relativePath || "").trim() || "/";
  const nextSurfaceBasePath = resolveSurfaceBasePath(context, normalizedSurface, {
    params,
    strictParams
  });

  return resolveLinkPath(nextSurfaceBasePath, nextRelativePath);
}

function useShellLinkResolver({ surface = "" } = {}) {
  const { context: placementContext } = useWebPlacementContext();

  function resolve(relativePath = "/", options = {}) {
    return resolveShellLinkPath({
      context: placementContext.value,
      surface: String(unref(options.surface ?? surface) || ""),
      explicitTo: options.explicitTo,
      relativePath,
      surfaceRelativePath: options.surfaceRelativePath,
      params: options.params,
      strictParams: options.strictParams !== false
    });
  }

  return Object.freeze({
    resolve
  });
}

export { resolveShellLinkPath, useShellLinkResolver };
