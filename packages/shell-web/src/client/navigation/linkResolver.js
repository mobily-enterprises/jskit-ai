import { unref } from "vue";
import { resolveLinkPath, normalizePathname } from "@jskit-ai/kernel/shared";
import { useWebPlacementContext } from "../placement/inject.js";
import {
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceRootPathFromPlacementContext,
  resolveSurfaceWorkspacePathFromPlacementContext,
  extractWorkspaceSlugFromSurfacePathname,
  surfaceRequiresWorkspaceFromPlacementContext
} from "../placement/surfaceContext.js";

function readBrowserPathname() {
  if (typeof window !== "object" || !window?.location?.pathname) {
    return "/";
  }
  return String(window.location.pathname || "").trim() || "/";
}

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

function resolveWorkspaceSlugFromContextOrPath({
  context = null,
  surface = "",
  workspaceSlug = "",
  pathname = ""
} = {}) {
  const explicitWorkspaceSlug = String(workspaceSlug || "").trim();
  if (explicitWorkspaceSlug) {
    return explicitWorkspaceSlug;
  }

  const workspaceSlugFromContext = String(context?.workspace?.slug || "").trim();
  if (workspaceSlugFromContext) {
    return workspaceSlugFromContext;
  }

  const currentPathname = String(pathname || "").trim() || readBrowserPathname();
  const workspaceSlugMatch = currentPathname.match(/\/w\/([^/]+)/);
  const workspaceSlugFromPath = String(workspaceSlugMatch?.[1] || "").trim();
  if (workspaceSlugFromPath) {
    return workspaceSlugFromPath;
  }

  const normalizedSurface = normalizeSurfaceId(surface);
  const surfaceIdFromPath = resolveSurfaceIdFromPlacementPathname(context, currentPathname);
  const activeSurfaceId = normalizeSurfaceId(surfaceIdFromPath || normalizedSurface);
  if (!activeSurfaceId) {
    return "";
  }

  return String(extractWorkspaceSlugFromSurfacePathname(context, activeSurfaceId, currentPathname) || "").trim();
}

function resolveWorkspaceBasePath(context = null, surface = "", workspaceSlug = "") {
  const normalizedSurface = normalizeSurfaceId(surface);
  const normalizedWorkspaceSlug = String(workspaceSlug || "").trim();
  if (!normalizedWorkspaceSlug) {
    return "";
  }

  if (normalizedSurface && resolveSurfaceDefinitionFromPlacementContext(context, normalizedSurface)) {
    return resolveSurfaceWorkspacePathFromPlacementContext(context, normalizedSurface, normalizedWorkspaceSlug, "/");
  }

  return resolveLinkPath(resolveSurfaceBasePath(context, normalizedSurface), `/w/${normalizedWorkspaceSlug}`);
}

function resolveShellLinkPath({
  context = null,
  surface = "",
  mode = "auto",
  explicitTo = "",
  relativePath = "/",
  workspaceRelativePath = "",
  surfaceRelativePath = "",
  workspaceSlug = "",
  pathname = ""
} = {}) {
  const explicitTarget = String(explicitTo || "").trim();
  if (explicitTarget) {
    return explicitTarget;
  }

  const normalizedSurface = normalizeSurfaceId(surface);
  const normalizedMode = String(mode || "auto").trim().toLowerCase();
  const hasSurfaceDefinition = Boolean(
    normalizedSurface && resolveSurfaceDefinitionFromPlacementContext(context, normalizedSurface)
  );
  const resolvedWorkspaceSlug = resolveWorkspaceSlugFromContextOrPath({
    context,
    surface: normalizedSurface,
    workspaceSlug,
    pathname
  });

  const nextWorkspaceRelativePath = String(workspaceRelativePath || "").trim() || String(relativePath || "").trim() || "/";
  const nextSurfaceRelativePath = String(surfaceRelativePath || "").trim() || String(relativePath || "").trim() || "/";
  const nextSurfaceBasePath = resolveSurfaceBasePath(context, normalizedSurface);

  if (normalizedMode === "surface") {
    return resolveLinkPath(nextSurfaceBasePath, nextSurfaceRelativePath);
  }

  if (normalizedMode === "workspace") {
    if (!resolvedWorkspaceSlug) {
      return "";
    }
    return resolveLinkPath(
      resolveWorkspaceBasePath(context, normalizedSurface, resolvedWorkspaceSlug),
      nextWorkspaceRelativePath
    );
  }

  if (hasSurfaceDefinition) {
    if (surfaceRequiresWorkspaceFromPlacementContext(context, normalizedSurface)) {
      if (!resolvedWorkspaceSlug) {
        return "";
      }
      return resolveLinkPath(
        resolveWorkspaceBasePath(context, normalizedSurface, resolvedWorkspaceSlug),
        nextWorkspaceRelativePath
      );
    }

    return resolveLinkPath(nextSurfaceBasePath, nextSurfaceRelativePath);
  }

  if (resolvedWorkspaceSlug) {
    return resolveLinkPath(
      resolveWorkspaceBasePath(context, normalizedSurface, resolvedWorkspaceSlug),
      nextWorkspaceRelativePath
    );
  }

  return resolveLinkPath(nextSurfaceBasePath, nextSurfaceRelativePath);
}

function useShellLinkResolver({ surface = "", workspaceSlug = "", pathname = "" } = {}) {
  const { context: placementContext } = useWebPlacementContext();

  function resolve(relativePath = "/", options = {}) {
    return resolveShellLinkPath({
      context: placementContext.value,
      surface: String(unref(options.surface ?? surface) || ""),
      workspaceSlug: String(unref(options.workspaceSlug ?? workspaceSlug) || ""),
      pathname: String(unref(options.pathname ?? pathname) || ""),
      mode: String(options.mode || "auto"),
      explicitTo: options.explicitTo,
      relativePath,
      workspaceRelativePath: options.workspaceRelativePath,
      surfaceRelativePath: options.surfaceRelativePath
    });
  }

  function toSurface(relativePath = "/", options = {}) {
    return resolve(relativePath, {
      ...options,
      mode: "surface"
    });
  }

  function toWorkspace(relativePath = "/", options = {}) {
    return resolve(relativePath, {
      ...options,
      mode: "workspace"
    });
  }

  function toAuto(relativePath = "/", options = {}) {
    return resolve(relativePath, {
      ...options,
      mode: "auto"
    });
  }

  return Object.freeze({
    resolve,
    toSurface,
    toWorkspace,
    toAuto
  });
}

export { readBrowserPathname, resolveWorkspaceSlugFromContextOrPath, resolveShellLinkPath, useShellLinkResolver };
