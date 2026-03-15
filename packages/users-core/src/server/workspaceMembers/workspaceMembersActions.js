import {
  resolveUser,
  resolveWorkspace
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
import { routeParamsValidator } from "../common/validators/routeParamsValidator.js";

const workspaceMembersActions = Object.freeze([
  {
    id: "workspace.roles.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    consoleUsersOnly: false,
    inputValidator: routeParamsValidator,
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
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    consoleUsersOnly: false,
    inputValidator: routeParamsValidator,
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
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    consoleUsersOnly: false,
    inputValidator: [routeParamsValidator, workspaceMembersResource.operations.updateMemberRole.bodyValidator],
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
    id: "workspace.invites.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    consoleUsersOnly: false,
    inputValidator: routeParamsValidator,
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
    channels: ["api", "assistant_tool", "internal"],
    surfacesFrom: "workspace",
    consoleUsersOnly: false,
    inputValidator: [routeParamsValidator, workspaceMembersResource.operations.createInvite.bodyValidator],
    outputValidator: workspaceMembersResource.operations.createInvite.outputValidator,
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.create"
    },
    observability: {},
    assistantTool: {
      description: "Invite a person to the workspace.",
      inputValidator: workspaceMembersResource.operations.createInvite.bodyValidator
    },
    async execute(input, context, deps) {
      return deps.workspaceMembersService.createInvite(
        resolveWorkspace(context, input),
        resolveUser(context, input),
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
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    consoleUsersOnly: false,
    inputValidator: routeParamsValidator,
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
