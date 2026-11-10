import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { resolveActor, resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";

function buildVisibilityContribution({ visibility, scopeOwnerId = null, userId = null } = {}) {
  const requiresActorScope = visibility === "workspace_user";
  const contribution = {
    scopeKind: requiresActorScope ? "workspace_user" : "workspace",
    requiresActorScope
  };

  if (scopeOwnerId) {
    contribution.scopeOwnerId = scopeOwnerId;
  }
  if (requiresActorScope && userId != null) {
    contribution.userId = userId;
  }

  return contribution;
}

/**
 * @param {object} dependencies
 * @param {import("../../types.js").WorkspaceDirectoryService} dependencies.workspaceService
 * @param {string[]} dependencies.workspaceMembershipOptionalSurfaceIds The surfaces' normalized ids.
 */
function createWorkspaceRouteVisibilityResolver({ workspaceService, workspaceMembershipOptionalSurfaceIds }) {
  const membershipOptionalSurfaceIds = new Set(workspaceMembershipOptionalSurfaceIds);

  async function resolve({ visibility, context, request, input } = {}) {
    if (visibility !== "workspace" && visibility !== "workspace_user") {
      return {};
    }

    const actor = resolveActor(context, request);
    const userId = resolveActorId(context, request);
    const workspace =
      context?.workspace || context?.requestMeta?.resolvedWorkspaceContext?.workspace || request?.workspace || null;
    const scopeOwnerId = normalizeRecordId(workspace?.id, { fallback: null });
    if (!scopeOwnerId) {
      const workspaceSlug = normalizeText(input?.workspaceSlug).toLowerCase();

      if (!workspaceSlug || !actor) {
        return visibility === "workspace_user"
          ? buildVisibilityContribution({
              visibility,
              userId
            })
          : {};
      }

      const activeSurfaceId = normalizeSurfaceId(
        request?.routeOptions?.config?.surface || context?.surface
      );
      // With the request, this is the resolution the workspace action context contributor then reuses.
      const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(
        actor,
        workspaceSlug,
        { requireMembership: !membershipOptionalSurfaceIds.has(activeSurfaceId), request }
      );

      return buildVisibilityContribution({
        visibility,
        scopeOwnerId: normalizeRecordId(resolvedWorkspaceContext.workspace.id),
        userId
      });
    }

    return buildVisibilityContribution({
      visibility,
      scopeOwnerId,
      userId
    });
  }

  return Object.freeze({
    resolverId: "workspaces.visibility",
    resolve
  });
}

export { createWorkspaceRouteVisibilityResolver };
