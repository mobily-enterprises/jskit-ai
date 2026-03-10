import {
  normalizeObject,
  requireAuthenticated,
  resolveRequest,
  resolveUser,
  resolveWorkspace,
  allowPublic,
  OBJECT_INPUT_SCHEMA
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { workspaceInviteSchema } from "../../shared/contracts/resources/workspaceInviteSchema.js";

const DEFAULT_WORKSPACE_CHANNELS = Object.freeze(["api", "internal"]);

function createWorkspaceActionDefinition({
  id,
  kind = "query",
  channels = DEFAULT_WORKSPACE_CHANNELS,
  surfacesFrom = "workspace",
  permission = requireAuthenticated,
  idempotency = "none",
  assistantTool = null,
  execute
} = {}) {
  const action = {
    id,
    version: 1,
    kind,
    channels,
    surfacesFrom,
    visibility: "public",
    inputSchema: OBJECT_INPUT_SCHEMA,
    permission,
    idempotency,
    audit: {
      actionName: id
    },
    observability: {},
    execute
  };

  if (assistantTool) {
    action.assistantTool = assistantTool;
  }

  return action;
}

const workspaceActions = Object.freeze([
  createWorkspaceActionDefinition({
    id: "workspace.bootstrap.read",
    surfacesFrom: "enabled",
    permission: allowPublic,
    execute: async (input, context, deps) => {
      const payload = normalizeObject(input);
      return deps.workspaceService.buildBootstrapPayload({
        request: resolveRequest(context),
        user: resolveUser(context, payload),
        workspaceSlug: payload.workspaceSlug
      });
    }
  }),
  createWorkspaceActionDefinition({
    id: "workspace.workspaces.list",
    surfacesFrom: "enabled",
    permission: requireAuthenticated,
    execute: async (input, context, deps) => {
      return {
        workspaces: await deps.workspaceService.listWorkspacesForUser(resolveUser(context, input), {
          request: resolveRequest(context)
        })
      };
    }
  }),
  createWorkspaceActionDefinition({
    id: "workspace.invitations.pending.list",
    surfacesFrom: "enabled",
    permission: requireAuthenticated,
    execute: async (input, context, deps) => {
      return {
        pendingInvites: await deps.workspaceService.listPendingInvitesForUser(resolveUser(context, input))
      };
    }
  }),
  createWorkspaceActionDefinition({
    id: "workspace.roles.list",
    permission: ["workspace.roles.view"],
    execute: async (_input, _context, deps) => {
      return {
        roleCatalog: deps.workspaceAdminService.getRoleCatalog()
      };
    }
  }),
  createWorkspaceActionDefinition({
    id: "workspace.members.list",
    permission: ["workspace.members.view"],
    execute: async (input, context, deps) => {
      return deps.workspaceAdminService.listMembers(resolveWorkspace(context, input));
    }
  }),
  createWorkspaceActionDefinition({
    id: "workspace.member.role.update",
    kind: "command",
    permission: ["workspace.members.manage"],
    idempotency: "optional",
    execute: async (input, context, deps) => {
      const payload = normalizeObject(input);
      return deps.workspaceAdminService.updateMemberRole(resolveWorkspace(context, payload), {
        memberUserId: payload.memberUserId || payload.userId || payload.targetUserId || payload.params?.memberUserId,
        roleId: payload.roleId
      });
    }
  }),
  createWorkspaceActionDefinition({
    id: "workspace.invites.list",
    permission: ["workspace.members.view"],
    execute: async (input, context, deps) => {
      return deps.workspaceAdminService.listInvites(resolveWorkspace(context, input));
    }
  }),
  createWorkspaceActionDefinition({
    id: "workspace.invite.create",
    kind: "command",
    channels: ["api", "assistant_tool", "internal"],
    permission: ["workspace.members.invite"],
    idempotency: "optional",
    assistantTool: {
      description: "Invite a person to the workspace.",
      inputJsonSchema: workspaceInviteSchema.operations.create.body.schema
    },
    execute: async (input, context, deps) => {
      return deps.workspaceAdminService.createInvite(
        resolveWorkspace(context, input),
        resolveUser(context, input),
        normalizeObject(input)
      );
    }
  }),
  createWorkspaceActionDefinition({
    id: "workspace.invite.revoke",
    kind: "command",
    permission: ["workspace.invites.revoke"],
    idempotency: "optional",
    execute: async (input, context, deps) => {
      const payload = normalizeObject(input);
      return deps.workspaceAdminService.revokeInvite(
        resolveWorkspace(context, payload),
        payload.inviteId || payload.params?.inviteId
      );
    }
  }),
  createWorkspaceActionDefinition({
    id: "workspace.invite.redeem",
    kind: "command",
    surfacesFrom: "enabled",
    permission: requireAuthenticated,
    idempotency: "optional",
    execute: async (input, context, deps) => {
      const payload = normalizeObject(input);
      return deps.workspaceAdminService.respondToPendingInviteByToken({
        user: resolveUser(context, payload),
        inviteToken: payload.token || payload.inviteToken,
        decision: payload.decision
      });
    }
  })
]);

export { workspaceActions };
