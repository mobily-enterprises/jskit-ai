import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { resolveWorkspace } from "../support/resolveWorkspace.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";

const updateMemberRoleActionInput = composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  workspaceMembersResource.operations.updateMemberRole.input
], {
  mode: workspaceMembersResource.operations.updateMemberRole.input.mode,
  context: "workspaceMembersActions.updateMemberRoleActionInput"
});

const removeMemberActionInput = composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  workspaceMembersResource.operations.removeMember.input
], {
  mode: workspaceMembersResource.operations.removeMember.input.mode,
  context: "workspaceMembersActions.removeMemberActionInput"
});

const createInviteActionInput = composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  workspaceMembersResource.operations.createInvite.body
], {
  mode: workspaceMembersResource.operations.createInvite.body.mode,
  context: "workspaceMembersActions.createInviteActionInput"
});

const revokeInviteActionInput = composeSchemaDefinitions([
  workspaceSlugParamsValidator,
  workspaceMembersResource.operations.revokeInvite.input
], {
  mode: workspaceMembersResource.operations.revokeInvite.input.mode,
  context: "workspaceMembersActions.revokeInviteActionInput"
});

const workspaceMembersActions = Object.freeze([
  {
    id: "workspace.roles.list",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "workspace",
    permission: {
      require: "all",
      permissions: ["workspace.roles.view"]
    },
    input: workspaceSlugParamsValidator,
    output: workspaceMembersResource.operations.rolesList.output,
    idempotency: "none",
    audit: {
      actionName: "workspace.roles.list"
    },
    observability: {},
    async execute(_input, context, deps) {
      return deps.workspaceMembersService.listRoles({ context });
    }
  },
  {
    id: "workspace.members.list",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "workspace",
    permission: {
      require: "all",
      permissions: ["workspace.members.view"]
    },
    input: workspaceSlugParamsValidator,
    output: workspaceMembersResource.operations.membersList.output,
    idempotency: "none",
    audit: {
      actionName: "workspace.members.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspaceMembersService.listMembers(resolveWorkspace(context, input), {
        context
      });
    }
  },
  {
    id: "workspace.member.role.update",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "workspace",
    permission: {
      require: "all",
      permissions: ["workspace.members.manage"]
    },
    input: updateMemberRoleActionInput,
    output: workspaceMembersResource.operations.updateMemberRole.output,
    idempotency: "optional",
    audit: {
      actionName: "workspace.member.role.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspaceMembersService.updateMemberRole(resolveWorkspace(context, input), {
        memberUserId: input.memberUserId,
        roleSid: input.roleSid
      }, {
        context
      });
    }
  },
  {
    id: "workspace.member.remove",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "workspace",
    permission: {
      require: "all",
      permissions: ["workspace.members.manage"]
    },
    input: removeMemberActionInput,
    output: workspaceMembersResource.operations.removeMember.output,
    idempotency: "optional",
    audit: {
      actionName: "workspace.member.remove"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspaceMembersService.removeMember(resolveWorkspace(context, input), {
        memberUserId: input.memberUserId
      }, {
        context
      });
    }
  },
  {
    id: "workspace.invites.list",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "workspace",
    permission: {
      require: "all",
      permissions: ["workspace.members.view"]
    },
    input: workspaceSlugParamsValidator,
    output: workspaceMembersResource.operations.invitesList.output,
    idempotency: "none",
    audit: {
      actionName: "workspace.invites.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspaceMembersService.listInvites(resolveWorkspace(context, input), {
        context
      });
    }
  },
  {
    id: "workspace.invite.create",
    version: 1,
    kind: "command",
    channels: ["api", "assistant_tool", "automation", "internal"],
    surfacesFrom: "workspace",
    permission: {
      require: "all",
      permissions: ["workspace.members.invite"]
    },
    input: createInviteActionInput,
    output: workspaceMembersResource.operations.createInvite.output,
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.create"
    },
    observability: {},
    extensions: {
      assistant: {
        description: "Invite a person to the workspace."
      }
    },
    async execute(input, context, deps) {
      return deps.workspaceMembersService.createInvite(
        resolveWorkspace(context, input),
        resolveActionUser(context, input),
        {
          email: input.email,
          roleSid: input.roleSid
        },
        {
          context
        }
      );
    }
  },
  {
    id: "workspace.invite.revoke",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "workspace",
    permission: {
      require: "all",
      permissions: ["workspace.invites.revoke"]
    },
    input: revokeInviteActionInput,
    output: workspaceMembersResource.operations.revokeInvite.output,
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.revoke"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspaceMembersService.revokeInvite(resolveWorkspace(context, input), input.inviteId, {
        context
      });
    }
  }
]);

export { workspaceMembersActions };
