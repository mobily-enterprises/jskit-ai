import { normalizeOpaqueId, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

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

function createWorkspaceRouteVisibilityResolver({ workspaceService } = {}) {
  if (!workspaceService || typeof workspaceService.resolveWorkspaceContextForUserBySlug !== "function") {
    throw new Error("workspace route visibility resolver requires workspaceService.resolveWorkspaceContextForUserBySlug().");
  }

  return Object.freeze({
    resolverId: "users.workspace.visibility",
    async resolve({ visibility, context, request, input } = {}) {
      if (visibility !== "workspace" && visibility !== "workspace_user") {
        return {};
      }

      const actor = context?.actor || request?.user || null;
      const userId = normalizeOpaqueId(actor?.id);
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

        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(actor, workspaceSlug, {
          request
        });
        const resolvedWorkspaceOwnerId = normalizeRecordId(resolvedWorkspaceContext?.workspace?.id, { fallback: null });
        if (!resolvedWorkspaceOwnerId) {
          return visibility === "workspace_user"
            ? buildVisibilityContribution({
                visibility,
                userId
              })
            : {};
        }

        return buildVisibilityContribution({
          visibility,
          scopeOwnerId: resolvedWorkspaceOwnerId,
          userId
        });
      }

      return buildVisibilityContribution({
        visibility,
        scopeOwnerId,
        userId
      });
    }
  });
}

export { createWorkspaceRouteVisibilityResolver };
