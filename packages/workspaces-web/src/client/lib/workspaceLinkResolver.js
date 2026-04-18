import { unref } from "vue";
import { resolveLinkPath } from "@jskit-ai/kernel/shared";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import {
  useWebPlacementContext,
  resolveRuntimePathname,
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceRootPathFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import {
  resolveWorkspaceSurfaceIdFromPlacementPathname,
  resolveSurfaceWorkspacePathFromPlacementContext,
  extractWorkspaceSlugFromSurfacePathname
} from "./workspaceSurfacePaths.js";
import { surfaceRequiresWorkspaceFromPlacementContext } from "./workspaceSurfaceContext.js";
import { parseWorkspacePathname } from "@jskit-ai/workspaces-core/shared/support/workspacePathModel";

function resolveSurfaceBasePath(context = null, surface = "") {
  const normalizedSurface = normalizeSurfaceId(surface);
  if (!normalizedSurface) {
    return "";
  }

  if (!resolveSurfaceDefinitionFromPlacementContext(context, normalizedSurface)) {
    return "";
  }

  return resolveSurfaceRootPathFromPlacementContext(context, normalizedSurface);
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
  const workspaceSlugFromPath = String(parseWorkspacePathname(currentPathname)?.workspaceSlug || "").trim();
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
  if (!normalizedSurface || !normalizedWorkspaceSlug) {
    return "";
  }

  if (!resolveSurfaceDefinitionFromPlacementContext(context, normalizedSurface)) {
    return "";
  }

  if (!surfaceRequiresWorkspaceFromPlacementContext(context, normalizedSurface)) {
    return resolveSurfaceBasePath(context, normalizedSurface);
  }

  return resolveSurfaceWorkspacePathFromPlacementContext(context, normalizedSurface, normalizedWorkspaceSlug, "/");
}

function resolveWorkspaceShellLinkPath({
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
  if (!hasSurfaceDefinition) {
    return "";
  }

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
    if (!surfaceRequiresWorkspaceFromPlacementContext(context, normalizedSurface)) {
      return resolveLinkPath(nextSurfaceBasePath, nextSurfaceRelativePath);
    }
    if (!resolvedWorkspaceSlug) {
      return "";
    }
    const workspaceBasePath = resolveWorkspaceBasePath(context, normalizedSurface, resolvedWorkspaceSlug);
    if (!workspaceBasePath) {
      return "";
    }
    return resolveLinkPath(
      workspaceBasePath,
      nextWorkspaceRelativePath
    );
  }

  if (surfaceRequiresWorkspaceFromPlacementContext(context, normalizedSurface)) {
    if (!resolvedWorkspaceSlug) {
      return "";
    }
    const workspaceBasePath = resolveWorkspaceBasePath(context, normalizedSurface, resolvedWorkspaceSlug);
    if (!workspaceBasePath) {
      return "";
    }
    return resolveLinkPath(
      workspaceBasePath,
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
