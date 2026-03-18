import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";

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

      const workspace =
        context?.workspace || context?.requestMeta?.resolvedWorkspaceContext?.workspace || request?.workspace || null;
      const workspaceOwnerId = parsePositiveInteger(workspace?.id);
      if (!workspaceOwnerId) {
        const workspaceSlug = normalizeText(input?.workspaceSlug).toLowerCase();
        const actor = context?.actor || request?.user || null;

        if (!workspaceSlug || !actor) {
          return {};
        }

        const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(actor, workspaceSlug, {
          request
        });
        const resolvedWorkspaceOwnerId = parsePositiveInteger(resolvedWorkspaceContext?.workspace?.id);
        if (!resolvedWorkspaceOwnerId) {
          return {};
        }

        return {
          workspaceOwnerId: resolvedWorkspaceOwnerId
        };
      }

      return {
        workspaceOwnerId
      };
    }
  });
}

export { createWorkspaceRouteVisibilityResolver };
