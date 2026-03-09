import {
  extractWorkspaceSlugFromSurfacePathname,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfacePathFromPlacementContext,
  resolveSurfaceWorkspacePathFromPlacementContext,
  surfaceRequiresWorkspaceFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";

function readBrowserPathname() {
  if (typeof window !== "object" || !window?.location?.pathname) {
    return "/";
  }

  const pathname = String(window.location.pathname || "").trim();
  return pathname || "/";
}

function resolveWorkspaceSlugFromContextOrPath({ context = null, surface = "", pathname = "" } = {}) {
  const workspaceSlugFromContext = String(context?.workspace?.slug || "").trim();
  if (workspaceSlugFromContext) {
    return workspaceSlugFromContext;
  }

  const currentPathname = String(pathname || "").trim() || readBrowserPathname();
  const surfaceIdFromPath = resolveSurfaceIdFromPlacementPathname(context, currentPathname);
  const fallbackSurfaceId = String(surface || "").trim().toLowerCase();
  const surfaceId = surfaceIdFromPath || fallbackSurfaceId;
  if (!surfaceId) {
    return "";
  }

  return String(extractWorkspaceSlugFromSurfacePathname(context, surfaceId, currentPathname) || "").trim();
}

function resolveSurfaceLinkTarget({
  context = null,
  surface = "",
  explicitTo = "",
  workspaceSuffix = "/",
  nonWorkspaceSuffix = "/",
  pathname = ""
} = {}) {
  const explicitTarget = String(explicitTo || "").trim();
  if (explicitTarget) {
    return explicitTarget;
  }

  const normalizedSurface = String(surface || "").trim().toLowerCase();
  if (!normalizedSurface) {
    return "";
  }

  if (surfaceRequiresWorkspaceFromPlacementContext(context, normalizedSurface)) {
    const workspaceSlug = resolveWorkspaceSlugFromContextOrPath({
      context,
      surface: normalizedSurface,
      pathname
    });
    if (!workspaceSlug) {
      return "";
    }

    return resolveSurfaceWorkspacePathFromPlacementContext(
      context,
      normalizedSurface,
      workspaceSlug,
      workspaceSuffix
    );
  }

  return resolveSurfacePathFromPlacementContext(context, normalizedSurface, nonWorkspaceSuffix);
}

export { resolveSurfaceLinkTarget };
