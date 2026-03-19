import { unref } from "vue";
import { resolveLinkPath, normalizePathname } from "@jskit-ai/kernel/shared";
import { useWebPlacementContext } from "../placement/inject.js";
import {
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceRootPathFromPlacementContext
} from "../placement/surfaceContext.js";

function normalizeSurfaceId(value = "") {
  return String(value || "").trim().toLowerCase();
}

function resolveSurfaceBasePath(context = null, surface = "") {
  const normalizedSurface = normalizeSurfaceId(surface);
  if (normalizedSurface && resolveSurfaceDefinitionFromPlacementContext(context, normalizedSurface)) {
    return resolveSurfaceRootPathFromPlacementContext(context, normalizedSurface);
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
  surfaceRelativePath = ""
} = {}) {
  const explicitTarget = String(explicitTo || "").trim();
  if (explicitTarget) {
    return explicitTarget;
  }

  const normalizedSurface = normalizeSurfaceId(surface);
  const nextRelativePath = String(surfaceRelativePath || "").trim() || String(relativePath || "").trim() || "/";
  const nextSurfaceBasePath = resolveSurfaceBasePath(context, normalizedSurface);

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
      surfaceRelativePath: options.surfaceRelativePath
    });
  }

  function toSurface(relativePath = "/", options = {}) {
    return resolve(relativePath, options);
  }

  function toWorkspace(relativePath = "/", options = {}) {
    return resolve(relativePath, options);
  }

  function toAuto(relativePath = "/", options = {}) {
    return resolve(relativePath, options);
  }

  return Object.freeze({
    resolve,
    toSurface,
    toWorkspace,
    toAuto
  });
}

export { resolveShellLinkPath, useShellLinkResolver };
