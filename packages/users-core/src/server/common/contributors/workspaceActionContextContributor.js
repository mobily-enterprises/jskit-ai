import {
  normalizeObject,
  requireServiceMethod
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { normalizeScopedRouteVisibility } from "../../../shared/support/usersVisibility.js";
import { resolveActionUser } from "../support/resolveActionUser.js";

const WORKSPACE_CONTEXT_ACTION_IDS = Object.freeze([
  "workspace.roles.list",
  "workspace.settings.read",
  "workspace.settings.update",
  "workspace.members.list",
  "workspace.member.role.update",
  "workspace.member.remove",
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
      if (!Object.hasOwn(payload, "workspaceSlug")) {
        return {};
      }

      const actionName = String(actionId || "").trim();
      const hasLegacyWorkspaceActionId = WORKSPACE_CONTEXT_ACTION_IDS.includes(actionName);
      const routeVisibility = normalizeScopedRouteVisibility(request?.routeOptions?.config?.visibility, {
        fallback: "public"
      });
      const hasWorkspaceRouteVisibility = WORKSPACE_VISIBILITY_ACTION_CONTEXT_SET.has(routeVisibility);
      if (!hasLegacyWorkspaceActionId && !hasWorkspaceRouteVisibility) {
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
