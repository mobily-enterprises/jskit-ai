import {
  normalizeObject,
  requireServiceMethod
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import {
  checkRouteVisibility,
  USERS_ROUTE_VISIBILITY_PUBLIC,
  USERS_ROUTE_VISIBILITY_WORKSPACE,
  USERS_ROUTE_VISIBILITY_WORKSPACE_USER
} from "../../../shared/support/usersVisibility.js";
import { resolveActionUser } from "../support/resolveActionUser.js";
const WORKSPACE_VISIBILITY_ACTION_CONTEXT_SET = new Set([
  USERS_ROUTE_VISIBILITY_WORKSPACE,
  USERS_ROUTE_VISIBILITY_WORKSPACE_USER
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

function createWorkspaceActionContextContributor({ workspaceService, workspaceSurfaceIds = [] } = {}) {
  const contributorId = "users.workspace.context";
  const workspaceSurfaceIdSet = normalizeWorkspaceSurfaceIds(workspaceSurfaceIds);

  requireServiceMethod(workspaceService, "resolveWorkspaceContextForUserBySlug", contributorId);

  return Object.freeze({
    contributorId,
    async contribute({ definition = null, input, context, request } = {}) {
      const payload = normalizeObject(input);
      if (!Object.hasOwn(payload, "workspaceSlug")) {
        return {};
      }

      const actionSurfaces = Array.isArray(definition?.surfaces) ? definition.surfaces : [];
      const hasWorkspaceActionSurface = actionSurfaces.some((surfaceId) => workspaceSurfaceIdSet.has(surfaceId));
      const routeSurfaceId = normalizeSurfaceId(request?.routeOptions?.config?.surface);
      const hasWorkspaceSurface = workspaceSurfaceIdSet.has(routeSurfaceId);
      const routeVisibilityInput =
        request && request.routeOptions && request.routeOptions.config
          ? request.routeOptions.config.visibility
          : USERS_ROUTE_VISIBILITY_PUBLIC;
      const routeVisibility = checkRouteVisibility(routeVisibilityInput);
      const hasWorkspaceRouteVisibility = WORKSPACE_VISIBILITY_ACTION_CONTEXT_SET.has(routeVisibility);
      if (!hasWorkspaceActionSurface && !hasWorkspaceRouteVisibility && !hasWorkspaceSurface) {
        return {};
      }

      const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(
        resolveActionUser(context, payload),
        payload.workspaceSlug,
        { request }
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
