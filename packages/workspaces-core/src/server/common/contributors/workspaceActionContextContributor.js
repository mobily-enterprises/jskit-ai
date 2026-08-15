import {
  normalizeObject,
  requireServiceMethod
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import {
  checkRouteVisibility,
  ROUTE_VISIBILITY_PUBLIC,
  ROUTE_VISIBILITY_WORKSPACE,
  ROUTE_VISIBILITY_WORKSPACE_USER
} from "@jskit-ai/kernel/shared/support/visibility";
import { resolveActionUser } from "../support/resolveActionUser.js";
const WORKSPACE_VISIBILITY_ACTION_CONTEXT_SET = new Set([
  ROUTE_VISIBILITY_WORKSPACE,
  ROUTE_VISIBILITY_WORKSPACE_USER
]);

function normalizeWorkspaceSurfaceIds(surfaceIds = []) {
  const source = Array.isArray(surfaceIds) ? surfaceIds : [];
  const normalized = new Set();

  for (const entry of source) {
    const surfaceId = normalizeSurfaceId(entry);
    if (!surfaceId) {
      continue;
    }
    normalized.add(surfaceId);
  }

  return normalized;
}

function createWorkspaceActionContextContributor({
  workspaceService,
  workspaceMembershipOptionalSurfaceIds = [],
  workspaceSurfaceIds = []
} = {}) {
  const contributorId = "workspaces.context";
  const workspaceMembershipOptionalSurfaceIdSet = normalizeWorkspaceSurfaceIds(
    workspaceMembershipOptionalSurfaceIds
  );
  const workspaceSurfaceIdSet = normalizeWorkspaceSurfaceIds(workspaceSurfaceIds);

  requireServiceMethod(workspaceService, "resolveWorkspaceContextForUserBySlug", contributorId);

  return Object.freeze({
    contributorId,
    async contribute({ definition = null, input, context, request, surface = "" } = {}) {
      const payload = normalizeObject(input);
      if (!Object.hasOwn(payload, "workspaceSlug")) {
        return {};
      }

      const actionSurfaces = Array.isArray(definition?.surfaces) ? definition.surfaces : [];
      const hasWorkspaceActionSurface = actionSurfaces.some((surfaceId) => workspaceSurfaceIdSet.has(surfaceId));
      const routeSurfaceId = normalizeSurfaceId(request?.routeOptions?.config?.surface);
      const activeSurfaceId = routeSurfaceId || normalizeSurfaceId(surface || context?.surface);
      const hasWorkspaceSurface = workspaceSurfaceIdSet.has(routeSurfaceId);
      const routeVisibilityInput =
        request && request.routeOptions && request.routeOptions.config
          ? request.routeOptions.config.visibility
          : ROUTE_VISIBILITY_PUBLIC;
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
  });
}

export { createWorkspaceActionContextContributor };
