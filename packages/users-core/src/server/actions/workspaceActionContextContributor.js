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

      if (context?.workspace) {
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

      return {
        workspace: resolvedWorkspaceContext.workspace,
        membership: resolvedWorkspaceContext.membership,
        permissions: resolvedWorkspaceContext.permissions
      };
    }
  });
}

export { createWorkspaceActionContextContributor };
