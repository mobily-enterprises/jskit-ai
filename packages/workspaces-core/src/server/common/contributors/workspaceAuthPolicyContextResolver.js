import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";

/**
 * @param {object} dependencies
 * @param {import("../../types.js").WorkspaceDirectoryService} dependencies.workspaceService
 * @param {string[]} dependencies.workspaceMembershipOptionalSurfaceIds The surfaces' normalized ids.
 */
function createWorkspaceAuthPolicyContextResolver({ workspaceService, workspaceMembershipOptionalSurfaceIds }) {
  const membershipOptionalSurfaceIds = new Set(workspaceMembershipOptionalSurfaceIds);

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
