import {
  resolveUser,
  resolveWorkspace
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { createWorkspaceRoleCatalog } from "../../shared/roles.js";
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
    permission: ["workspace.roles.view"],
    idempotency: "none",
    audit: {
      actionName: "workspace.roles.list"
    },
    observability: {},
    async execute() {
      return createWorkspaceRoleCatalog();
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
    permission: ["workspace.members.view"],
    idempotency: "none",
    audit: {
      actionName: "workspace.members.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspaceMembersService.listMembers(resolveWorkspace(context, input));
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
    permission: ["workspace.members.manage"],
    idempotency: "optional",
    audit: {
      actionName: "workspace.member.role.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspaceMembersService.updateMemberRole(resolveWorkspace(context, input), {
        memberUserId: input.memberUserId,
        roleId: input.roleId
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
    permission: ["workspace.members.view"],
    idempotency: "none",
    audit: {
      actionName: "workspace.invites.list"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspaceMembersService.listInvites(resolveWorkspace(context, input));
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
    permission: ["workspace.members.invite"],
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
    permission: ["workspace.invites.revoke"],
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.revoke"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspaceMembersService.revokeInvite(resolveWorkspace(context, input), input.inviteId);
    }
  }
]);

export { workspaceMembersActions };
