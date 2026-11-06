import { unref } from "vue";
import { resolveLinkPath, normalizePathname } from "@jskit-ai/kernel/shared";
import { isExternalLinkTarget } from "@jskit-ai/kernel/shared/support/linkPath";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { useWebPlacementContext } from "../placement/inject.js";
import {
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceRootPathFromPlacementContext
} from "../placement/surfaceContext.js";
import { normalizeRouteParams } from "../support/routeParams.js";

// Fills each `:name` segment of a path from params. A param the params lack throws when strict and otherwise stays as
// written. Only a path segment that starts with ":" is a param; a query and a hash are left alone.
function fillPathParams(pathTemplate = "/", { params = {}, strictParams = true, label = "route params" } = {}) {
  const template = String(pathTemplate || "/");
  const suffixStart = template.search(/[?#]/u);
  const pathPart = suffixStart < 0 ? template : template.slice(0, suffixStart);
  const suffix = suffixStart < 0 ? "" : template.slice(suffixStart);
  const normalizedParams = normalizeRouteParams(params);
  const missingParams = new Set();
  const outputPath = pathPart.replace(/(^|\/):([A-Za-z0-9_]+)/g, (full, start, paramName) => {
    const paramValue = normalizedParams[paramName];
    if (!paramValue) {
      missingParams.add(paramName);
      return full;
    }
    return `${start}${encodeURIComponent(paramValue)}`;
  });

  if (strictParams && missingParams.size > 0) {
    const missing = [...missingParams].sort().join(", ");
    throw new Error(`Missing required ${label}: ${missing}.`);
  }

  return `${outputPath}${suffix}`;
}

function resolveSurfaceBasePath(context = null, surface = "", { params = {}, strictParams = true } = {}) {
  const normalizedSurface = normalizeSurfaceId(surface);
  if (normalizedSurface && resolveSurfaceDefinitionFromPlacementContext(context, normalizedSurface)) {
    const routeBaseTemplate = resolveSurfaceRootPathFromPlacementContext(context, normalizedSurface);
    return fillPathParams(routeBaseTemplate, {
      params,
      strictParams,
      label: `surface route params for "${normalizedSurface}"`
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

  // A relative path may name params too, like a declared parent "/books/:bookId"; they fill from the same params.
  // An external URL is another site's, so it stays as written.
  const filledRelativePath = isExternalLinkTarget(nextRelativePath)
    ? nextRelativePath
    : fillPathParams(nextRelativePath, { params, strictParams, label: `route params for "${nextRelativePath}"` });

  return resolveLinkPath(nextSurfaceBasePath, filledRelativePath);
}

/**
 * @param {object} [options]
 * @param {import("vue").MaybeRef<string>} [options.surface] The surface a link resolves on, unless it names its own.
 */
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

  return {
    resolve
  };
}

export { resolveShellLinkPath, useShellLinkResolver };
