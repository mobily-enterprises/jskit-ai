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

    const activeSurfaceId = normalizeSurfaceId(request?.routeOptions?.config?.surface);
    const requireMembership = !(
      (contextPolicy === "optional" && !permission) ||
      membershipOptionalSurfaceIds.has(activeSurfaceId)
    );

    const { workspace, membership, permissions } = await workspaceService.resolveWorkspaceContextForUserBySlug(
      actor,
      workspaceSlug,
      { requireMembership }
    );

    return { workspace, membership, permissions };
  };
}

export { createWorkspaceAuthPolicyContextResolver };
