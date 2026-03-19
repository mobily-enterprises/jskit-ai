import { unref } from "vue";
import { resolveLinkPath, normalizePathname } from "@jskit-ai/kernel/shared";
import { useWebPlacementContext } from "../placement/inject.js";
import {
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceRootPathFromPlacementContext
} from "../placement/surfaceContext.js";
import { readPlacementSurfaceRoles, resolveSurfaceIdForRole } from "../placement/surfaceRoles.js";

function normalizeSurfaceId(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeSurfaceRole(value = "") {
  return String(value || "").trim().toLowerCase();
}

function resolveSurfaceIdFromRole(context = null, surfaceRole = "") {
  const normalizedSurfaceRole = normalizeSurfaceRole(surfaceRole);
  if (!normalizedSurfaceRole) {
    return "";
  }
  const surfaceRoles = readPlacementSurfaceRoles(context);
  return resolveSurfaceIdForRole(surfaceRoles, normalizedSurfaceRole);
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
  surfaceRole = "",
  explicitTo = "",
  relativePath = "/",
  surfaceRelativePath = ""
} = {}) {
  const explicitTarget = String(explicitTo || "").trim();
  if (explicitTarget) {
    return explicitTarget;
  }

  const normalizedSurfaceFromInput = normalizeSurfaceId(surface);
  const normalizedSurface = normalizedSurfaceFromInput || resolveSurfaceIdFromRole(context, surfaceRole);
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
      surfaceRole: String(unref(options.surfaceRole ?? "") || ""),
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
