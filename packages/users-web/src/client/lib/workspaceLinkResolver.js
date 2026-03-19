import { unref } from "vue";
import { resolveLinkPath } from "@jskit-ai/kernel/shared";
import {
  useWebPlacementContext,
  resolveRuntimePathname,
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceRootPathFromPlacementContext,
  readPlacementSurfaceRoles,
  resolveSurfaceIdForRole
} from "@jskit-ai/shell-web/client/placement";
import {
  resolveWorkspaceSurfaceIdFromPlacementPathname,
  resolveSurfaceWorkspacePathFromPlacementContext,
  extractWorkspaceSlugFromSurfacePathname
} from "./workspaceSurfacePaths.js";
import { surfaceRequiresWorkspaceFromPlacementContext } from "./workspaceSurfaceContext.js";

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

  return `/${normalizedSurface}`;
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

  const currentPathname = resolveRuntimePathname(pathname);
  const workspaceSlugMatch = currentPathname.match(/\/w\/([^/]+)/);
  const workspaceSlugFromPath = String(workspaceSlugMatch?.[1] || "").trim();
  if (workspaceSlugFromPath) {
    return workspaceSlugFromPath;
  }

  const normalizedSurface = normalizeSurfaceId(surface);
  const workspaceSurfaceId = resolveWorkspaceSurfaceIdFromPlacementPathname(context, currentPathname);
  const surfaceIdFromPath = workspaceSurfaceId || resolveSurfaceIdFromPlacementPathname(context, currentPathname);
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
    if (!surfaceRequiresWorkspaceFromPlacementContext(context, normalizedSurface)) {
      return resolveSurfaceBasePath(context, normalizedSurface);
    }
    return resolveSurfaceWorkspacePathFromPlacementContext(context, normalizedSurface, normalizedWorkspaceSlug, "/");
  }

  if (normalizedSurface) {
    if (normalizedSurface === "console") {
      return "/console";
    }
    if (normalizedSurface === "app") {
      return `/w/${normalizedWorkspaceSlug}`;
    }
    return `/w/${normalizedWorkspaceSlug}/${normalizedSurface}`;
  }

  return `/w/${normalizedWorkspaceSlug}`;
}

function resolveWorkspaceShellLinkPath({
  context = null,
  surface = "",
  surfaceRole = "",
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

  const normalizedSurfaceFromInput = normalizeSurfaceId(surface);
  const normalizedSurface = normalizedSurfaceFromInput || resolveSurfaceIdFromRole(context, surfaceRole);
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
    if (hasSurfaceDefinition && !surfaceRequiresWorkspaceFromPlacementContext(context, normalizedSurface)) {
      return resolveLinkPath(nextSurfaceBasePath, nextSurfaceRelativePath);
    }
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

function useWorkspaceLinkResolver({ surface = "", workspaceSlug = "", pathname = "" } = {}) {
  const { context: placementContext } = useWebPlacementContext();

  function resolve(relativePath = "/", options = {}) {
    return resolveWorkspaceShellLinkPath({
      context: placementContext.value,
      surface: String(unref(options.surface ?? surface) || ""),
      surfaceRole: String(unref(options.surfaceRole ?? "") || ""),
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

export {
  resolveWorkspaceSlugFromContextOrPath,
  resolveWorkspaceShellLinkPath,
  useWorkspaceLinkResolver
};
