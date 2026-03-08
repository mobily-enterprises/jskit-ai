import {
  resolveSurfacePathFromPlacementContext,
  surfaceRequiresWorkspaceFromPlacementContext,
  resolveSurfaceWorkspacePathFromPlacementContext,
  resolveSurfaceWorkspacesPathFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";

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
    const workspaceSlug = String(context?.workspace?.slug || "").trim();
    if (workspaceSlug) {
      return resolveSurfaceWorkspacePathFromPlacementContext(context, surface, workspaceSlug, workspaceSuffix);
    }
    return resolveSurfaceWorkspacesPathFromPlacementContext(context, surface);
  }

  return resolveSurfacePathFromPlacementContext(context, surface, nonWorkspaceSuffix);
}

export { resolveWorkspaceAwareMenuTarget };
