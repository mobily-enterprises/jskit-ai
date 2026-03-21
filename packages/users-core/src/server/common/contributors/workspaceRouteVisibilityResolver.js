import { normalizeOpaqueId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";

function buildVisibilityContribution({ visibility, scopeOwnerId = 0, userOwnerId = null } = {}) {
  const requiresActorScope = visibility === "workspace_user";
  const contribution = {
    scopeKind: requiresActorScope ? "workspace_user" : "workspace",
    requiresActorScope
  };

  if (scopeOwnerId > 0) {
    contribution.scopeOwnerId = scopeOwnerId;
  }
  if (requiresActorScope && userOwnerId != null) {
    contribution.userOwnerId = userOwnerId;
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
      const userOwnerId = normalizeOpaqueId(actor?.id);
      const workspace =
        context?.workspace || context?.requestMeta?.resolvedWorkspaceContext?.workspace || request?.workspace || null;
      const scopeOwnerId = parsePositiveInteger(workspace?.id);
      if (!scopeOwnerId) {
        const workspaceSlug = normalizeText(input?.workspaceSlug).toLowerCase();

        if (!workspaceSlug || !actor) {
          return visibility === "workspace_user"
            ? buildVisibilityContribution({
                visibility,
                userOwnerId
              })
            : {};
        }

        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(actor, workspaceSlug, {
          request
        });
        const resolvedWorkspaceOwnerId = parsePositiveInteger(resolvedWorkspaceContext?.workspace?.id);
        if (!resolvedWorkspaceOwnerId) {
          return visibility === "workspace_user"
            ? buildVisibilityContribution({
                visibility,
                userOwnerId
              })
            : {};
        }

        return buildVisibilityContribution({
          visibility,
          scopeOwnerId: resolvedWorkspaceOwnerId,
          userOwnerId
        });
      }

      return buildVisibilityContribution({
        visibility,
        scopeOwnerId,
        userOwnerId
      });
    }
  });
}

export { createWorkspaceRouteVisibilityResolver };
