import { resolveRequest } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import {
  checkRouteVisibility,
  ROUTE_VISIBILITY_PUBLIC,
  ROUTE_VISIBILITY_WORKSPACE,
  ROUTE_VISIBILITY_WORKSPACE_USER
} from "@jskit-ai/kernel/shared/support/visibility";
import { resolveActionUser } from "@jskit-ai/users-core/server/resolveActionUser";
const WORKSPACE_VISIBILITY_ACTION_CONTEXT_SET = new Set([
  ROUTE_VISIBILITY_WORKSPACE,
  ROUTE_VISIBILITY_WORKSPACE_USER
]);

/**
 * @param {object} dependencies
 * @param {import("../services/workspaceContextService.js").WorkspaceContextService} dependencies.workspaceService
 * @param {string[]} dependencies.workspaceMembershipOptionalSurfaceIds The surfaces' normalized ids.
 * @param {string[]} dependencies.workspaceSurfaceIds The surfaces' normalized ids.
 */
function createWorkspaceActionContextContributor({
  workspaceService,
  workspaceMembershipOptionalSurfaceIds,
  workspaceSurfaceIds
}) {
  const contributorId = "workspaces.context";
  const workspaceMembershipOptionalSurfaceIdSet = new Set(workspaceMembershipOptionalSurfaceIds);
  const workspaceSurfaceIdSet = new Set(workspaceSurfaceIds);

  async function contribute({ definition = null, input, context } = {}) {
    const payload = normalizeObject(input);
    if (!Object.hasOwn(payload, "workspaceSlug")) {
      return {};
    }

    const request = resolveRequest(context);
    const actionSurfaces = Array.isArray(definition?.surfaces) ? definition.surfaces : [];
    const hasWorkspaceActionSurface = actionSurfaces.some((surfaceId) => workspaceSurfaceIdSet.has(surfaceId));
    const routeSurfaceId = normalizeSurfaceId(request?.routeOptions?.config?.surface);
    const activeSurfaceId = routeSurfaceId || normalizeSurfaceId(context?.surface);
    const hasWorkspaceSurface = workspaceSurfaceIdSet.has(routeSurfaceId);
    const routeVisibilityInput =
      context?.routeVisibility ?? request?.routeOptions?.config?.visibility ?? ROUTE_VISIBILITY_PUBLIC;
    const routeVisibility = checkRouteVisibility(routeVisibilityInput);
    const hasWorkspaceRouteVisibility = WORKSPACE_VISIBILITY_ACTION_CONTEXT_SET.has(routeVisibility);
    if (!hasWorkspaceActionSurface && !hasWorkspaceRouteVisibility && !hasWorkspaceSurface) {
      return {};
    }

    const resolveOptions = { request };
    if (workspaceMembershipOptionalSurfaceIdSet.has(activeSurfaceId)) {
      resolveOptions.requireMembership = false;
    }

    const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(
      resolveActionUser(context, payload),
      payload.workspaceSlug,
      resolveOptions
    );

    const contribution = {
      requestMeta: {
        resolvedWorkspaceContext
      }
    };

    if (!context?.workspace) {
      contribution.workspace = resolvedWorkspaceContext.workspace;
    }
    if (!context?.membership) {
      contribution.membership = resolvedWorkspaceContext.membership;
    }
    if (!Array.isArray(context?.permissions) || context.permissions.length < 1) {
      contribution.permissions = resolvedWorkspaceContext.permissions;
    }

    return contribution;
  }

  return Object.freeze({ contributorId, contribute });
}

export { createWorkspaceActionContextContributor };
