import {
  resolveSurfacePathFromPlacementContext,
  surfaceRequiresWorkspaceFromPlacementContext,
  resolveSurfaceWorkspacePathFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  extractWorkspaceSlugFromSurfacePathname
} from "@jskit-ai/shell-web/client/placement";

function resolveWorkspaceSlugFromContextOrUrl(context = null, surface = "") {
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
  explicitTo = "",
  workspaceSuffix = "/",
  nonWorkspaceSuffix = "/"
} = {}) {
  const explicitTarget = String(explicitTo || "").trim();
  if (explicitTarget) {
    return explicitTarget;
  }

  if (surfaceRequiresWorkspaceFromPlacementContext(context, surface)) {
    const workspaceSlug = resolveWorkspaceSlugFromContextOrUrl(context, surface);
    if (!workspaceSlug) {
      return "";
    }

    return resolveSurfaceWorkspacePathFromPlacementContext(context, surface, workspaceSlug, workspaceSuffix);
  }

  return resolveSurfacePathFromPlacementContext(context, surface, nonWorkspaceSuffix);
}

export { resolveWorkspaceAwareMenuTarget };
