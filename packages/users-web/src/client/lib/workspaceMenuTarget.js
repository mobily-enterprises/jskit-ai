import {
  resolveSurfacePathFromPlacementContext,
  surfaceRequiresWorkspaceFromPlacementContext,
  resolveSurfaceWorkspacePathFromPlacementContext,
  resolveSurfaceDefinitionFromPlacementContext,
  joinSurfacePath,
  resolveSurfaceIdFromPlacementPathname,
  extractWorkspaceSlugFromSurfacePathname
} from "@jskit-ai/shell-web/client/placement";

function resolveSurfacePathWithFallback(context = null, surface = "", pathname = "") {
  const normalizedSurface = String(surface || "").trim().toLowerCase();
  if (resolveSurfaceDefinitionFromPlacementContext(context, normalizedSurface)) {
    return resolveSurfacePathFromPlacementContext(context, normalizedSurface, pathname);
  }
  if (!normalizedSurface) {
    return String(pathname || "").trim() || "/";
  }
  return joinSurfacePath(`/${normalizedSurface}`, pathname);
}

function resolveSurfaceWorkspacePathWithFallback(context = null, surface = "", workspaceSlug = "", suffix = "/") {
  const normalizedSurface = String(surface || "").trim().toLowerCase();
  if (resolveSurfaceDefinitionFromPlacementContext(context, normalizedSurface)) {
    return resolveSurfaceWorkspacePathFromPlacementContext(context, normalizedSurface, workspaceSlug, suffix);
  }

  const normalizedWorkspaceSlug = String(workspaceSlug || "").trim();
  if (!normalizedWorkspaceSlug) {
    return resolveSurfacePathWithFallback(context, surface, "/workspaces");
  }

  const rawSuffix = String(suffix || "/").trim();
  const normalizedSuffix = rawSuffix ? (rawSuffix.startsWith("/") ? rawSuffix : `/${rawSuffix}`) : "/";
  const workspacePath = normalizedSuffix === "/" ? `/w/${normalizedWorkspaceSlug}` : `/w/${normalizedWorkspaceSlug}${normalizedSuffix}`;
  return resolveSurfacePathWithFallback(context, surface, workspacePath);
}

function resolveWorkspaceSlugFromContextOrUrl(context = null, surface = "", workspaceSlug = "") {
  const explicitWorkspaceSlug = String(workspaceSlug || "").trim();
  if (explicitWorkspaceSlug) {
    return explicitWorkspaceSlug;
  }

  const workspaceSlugFromContext = String(context?.workspace?.slug || "").trim();
  if (workspaceSlugFromContext) {
    return workspaceSlugFromContext;
  }

  if (typeof window !== "object" || !window?.location?.pathname) {
    return "";
  }

  const pathname = String(window.location.pathname || "").trim();
  if (!pathname) {
    return "";
  }

  const workspaceSlugMatch = pathname.match(/\/w\/([^/]+)/);
  const workspaceSlugFromPath = String(workspaceSlugMatch?.[1] || "").trim();
  if (workspaceSlugFromPath) {
    return workspaceSlugFromPath;
  }

  const surfaceIdFromPath = resolveSurfaceIdFromPlacementPathname(context, pathname);
  const fallbackSurfaceId = String(surface || "").trim().toLowerCase();
  const surfaceId = surfaceIdFromPath || fallbackSurfaceId;
  if (!surfaceId) {
    return "";
  }

  return String(extractWorkspaceSlugFromSurfacePathname(context, surfaceId, pathname) || "").trim();
}

function resolveWorkspaceAwareMenuTarget({
  context = null,
  surface = "",
  workspaceSlug = "",
  explicitTo = "",
  workspaceSuffix = "/",
  nonWorkspaceSuffix = "/"
} = {}) {
  const explicitTarget = String(explicitTo || "").trim();
  if (explicitTarget) {
    return explicitTarget;
  }

  const resolvedWorkspaceSlug = resolveWorkspaceSlugFromContextOrUrl(context, surface, workspaceSlug);
  if (resolvedWorkspaceSlug) {
    return resolveSurfaceWorkspacePathWithFallback(context, surface, resolvedWorkspaceSlug, workspaceSuffix);
  }

  if (surfaceRequiresWorkspaceFromPlacementContext(context, surface)) {
    return "";
  }

  return resolveSurfacePathWithFallback(context, surface, nonWorkspaceSuffix);
}

export { resolveWorkspaceAwareMenuTarget };
