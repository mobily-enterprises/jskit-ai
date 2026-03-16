import {
  normalizeObject,
  requireServiceMethod,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { normalizeRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";

const WORKSPACE_CONTEXT_ACTION_IDS = Object.freeze([
  "workspace.roles.list",
  "workspace.settings.read",
  "workspace.settings.update",
  "workspace.members.list",
  "workspace.member.role.update",
  "workspace.invites.list",
  "workspace.invite.create",
  "workspace.invite.revoke"
]);
const WORKSPACE_VISIBILITY_ACTION_CONTEXT_SET = new Set(["workspace", "workspace_user"]);

function createWorkspaceActionContextContributor({ workspaceService } = {}) {
  const contributorId = "users.workspace.context";

  requireServiceMethod(workspaceService, "resolveWorkspaceContextForUserBySlug", contributorId);

  return Object.freeze({
    contributorId,
    async contribute({ actionId, input, context, request } = {}) {
      const payload = normalizeObject(input);
      if (!Object.prototype.hasOwnProperty.call(payload, "workspaceSlug")) {
        return {};
      }

      const actionName = String(actionId || "").trim();
      const hasLegacyWorkspaceActionId = WORKSPACE_CONTEXT_ACTION_IDS.includes(actionName);
      const routeVisibility = normalizeRouteVisibility(request?.routeOptions?.config?.visibility);
      const hasWorkspaceRouteVisibility = WORKSPACE_VISIBILITY_ACTION_CONTEXT_SET.has(routeVisibility);
      if (!hasLegacyWorkspaceActionId && !hasWorkspaceRouteVisibility) {
        return {};
      }

      const resolvedWorkspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(
        resolveUser(context, payload),
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
