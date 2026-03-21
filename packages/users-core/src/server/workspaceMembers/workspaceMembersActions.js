import { resolveWorkspace } from "../support/resolveWorkspace.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";

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
    inputValidator: workspaceSlugParamsValidator,
    outputValidator: workspaceMembersResource.operations.rolesList.outputValidator,
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
    inputValidator: workspaceSlugParamsValidator,
    outputValidator: workspaceMembersResource.operations.membersList.outputValidator,
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
    inputValidator: [workspaceSlugParamsValidator, workspaceMembersResource.operations.updateMemberRole.inputValidator],
    outputValidator: workspaceMembersResource.operations.updateMemberRole.outputValidator,
    idempotency: "optional",
    audit: {
      actionName: "workspace.member.role.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspaceMembersService.updateMemberRole(resolveWorkspace(context, input), {
        memberUserId: input.memberUserId,
        roleId: input.roleId
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
    inputValidator: [workspaceSlugParamsValidator, workspaceMembersResource.operations.removeMember.inputValidator],
    outputValidator: workspaceMembersResource.operations.removeMember.outputValidator,
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
    inputValidator: workspaceSlugParamsValidator,
    outputValidator: workspaceMembersResource.operations.invitesList.outputValidator,
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
    inputValidator: [workspaceSlugParamsValidator, workspaceMembersResource.operations.createInvite.bodyValidator],
    outputValidator: workspaceMembersResource.operations.createInvite.outputValidator,
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
          roleId: input.roleId
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
    inputValidator: [workspaceSlugParamsValidator, workspaceMembersResource.operations.revokeInvite.inputValidator],
    outputValidator: workspaceMembersResource.operations.revokeInvite.outputValidator,
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
