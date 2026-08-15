import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";

function createWorkspaceAuthPolicyContextResolver({
  workspaceService,
  workspaceMembershipOptionalSurfaceIds = []
} = {}) {
  if (!workspaceService || typeof workspaceService.resolveWorkspaceContextForUserBySlug !== "function") {
    throw new Error(
      "workspace auth policy context resolver requires workspaceService.resolveWorkspaceContextForUserBySlug()."
    );
  }

  const membershipOptionalSurfaceIds = new Set(
    (Array.isArray(workspaceMembershipOptionalSurfaceIds) ? workspaceMembershipOptionalSurfaceIds : [])
      .map((entry) => normalizeSurfaceId(entry))
      .filter(Boolean)
  );

  return async function resolveWorkspaceAuthPolicyContext({ request, actor, meta } = {}) {
    const contextPolicy = normalizeText(meta?.contextPolicy || "none").toLowerCase() || "none";
    const permission = normalizeText(meta?.permission);
    if (contextPolicy === "none" && !permission) {
      return {};
    }

    const workspaceSlug = normalizeText(request?.params?.workspaceSlug).toLowerCase();
    if (!workspaceSlug || !actor) {
      return {};
    }

    const resolveOptions = { request };
    const activeSurfaceId = normalizeSurfaceId(request?.routeOptions?.config?.surface);
    if (
      (contextPolicy === "optional" && !permission) ||
      membershipOptionalSurfaceIds.has(activeSurfaceId)
    ) {
      resolveOptions.requireMembership = false;
    }

    const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(
      actor,
      workspaceSlug,
      resolveOptions
    );

    return {
      workspace: resolvedWorkspaceContext?.workspace || null,
      membership: resolvedWorkspaceContext?.membership || null,
      permissions: Array.isArray(resolvedWorkspaceContext?.permissions) ? resolvedWorkspaceContext.permissions : []
    };
  };
}

export { createWorkspaceAuthPolicyContextResolver };
