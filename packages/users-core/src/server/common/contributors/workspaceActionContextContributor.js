import {
  normalizeObject,
  requireServiceMethod,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";

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

function createWorkspaceActionContextContributor({ workspaceService } = {}) {
  const contributorId = "users.workspace.context";

  requireServiceMethod(workspaceService, "resolveWorkspaceContextForUserBySlug", contributorId);

  return Object.freeze({
    contributorId,
    async contribute({ actionId, input, context, request } = {}) {
      if (!WORKSPACE_CONTEXT_ACTION_IDS.includes(String(actionId || "").trim())) {
        return {};
      }

      const payload = normalizeObject(input);
      if (!Object.prototype.hasOwnProperty.call(payload, "workspaceSlug")) {
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
