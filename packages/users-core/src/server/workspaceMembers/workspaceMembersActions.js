import {
  EMPTY_INPUT_CONTRACT,
  normalizeObject,
  OBJECT_INPUT_SCHEMA,
  resolveUser,
  resolveWorkspace
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { workspaceInviteSchema } from "../../shared/contracts/resources/workspaceInviteSchema.js";

const workspaceMembersActions = Object.freeze([
  {
    id: "workspace.roles.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    visibility: "public",
    input: EMPTY_INPUT_CONTRACT,
    permission: ["workspace.roles.view"],
    idempotency: "none",
    audit: {
      actionName: "workspace.roles.list"
    },
    observability: {},
    async execute(_input, _context, deps) {
      return {
        roleCatalog: deps.workspaceAdminService.getRoleCatalog()
      };
    }
  },
  {
    id: "workspace.members.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    visibility: "public",
    input: { schema: OBJECT_INPUT_SCHEMA },
    permission: ["workspace.members.view"],
    idempotency: "none",
    audit: {
      actionName: "workspace.members.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspaceAdminService.listMembers(resolveWorkspace(context, input));
    }
  },
  {
    id: "workspace.member.role.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    visibility: "public",
    input: { schema: OBJECT_INPUT_SCHEMA },
    permission: ["workspace.members.manage"],
    idempotency: "optional",
    audit: {
      actionName: "workspace.member.role.update"
    },
    observability: {},
    async execute(input, context, deps) {
      const payload = normalizeObject(input);
      return deps.workspaceAdminService.updateMemberRole(resolveWorkspace(context, payload), {
        memberUserId: payload.memberUserId || payload.userId || payload.targetUserId || payload.params?.memberUserId,
        roleId: payload.roleId
      });
    }
  },
  {
    id: "workspace.invites.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    visibility: "public",
    input: { schema: OBJECT_INPUT_SCHEMA },
    permission: ["workspace.members.view"],
    idempotency: "none",
    audit: {
      actionName: "workspace.invites.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspaceAdminService.listInvites(resolveWorkspace(context, input));
    }
  },
  {
    id: "workspace.invite.create",
    version: 1,
    kind: "command",
    channels: ["api", "assistant_tool", "internal"],
    surfacesFrom: "workspace",
    visibility: "public",
    input: { schema: OBJECT_INPUT_SCHEMA },
    permission: ["workspace.members.invite"],
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.create"
    },
    observability: {},
    assistantTool: {
      description: "Invite a person to the workspace.",
      inputJsonSchema: workspaceInviteSchema.operations.create.body.schema
    },
    async execute(input, context, deps) {
      return deps.workspaceAdminService.createInvite(
        resolveWorkspace(context, input),
        resolveUser(context, input),
        normalizeObject(input)
      );
    }
  },
  {
    id: "workspace.invite.revoke",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    visibility: "public",
    input: { schema: OBJECT_INPUT_SCHEMA },
    permission: ["workspace.invites.revoke"],
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.revoke"
    },
    observability: {},
    async execute(input, context, deps) {
      const payload = normalizeObject(input);
      return deps.workspaceAdminService.revokeInvite(
        resolveWorkspace(context, payload),
        payload.inviteId || payload.params?.inviteId
      );
    }
  }
]);

export { workspaceMembersActions };
