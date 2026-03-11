import {
  resolveUser,
  resolveWorkspace
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { createWorkspaceRoleCatalog } from "../../shared/roles.js";
import {
  workspaceInviteCreateActionInput,
  workspaceInviteRevokeActionInput,
  workspaceInvitesOutput,
  workspaceMemberRoleUpdateActionInput,
  workspaceMembersOutput,
  workspaceRoleCatalogOutput,
  workspaceScopeActionInput
} from "./workspaceMembersContracts.js";

const workspaceMembersActions = Object.freeze([
  {
    id: "workspace.roles.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    visibility: "public",
    input: workspaceScopeActionInput,
    output: workspaceRoleCatalogOutput,
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
    visibility: "public",
    input: workspaceScopeActionInput,
    output: workspaceMembersOutput,
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
    visibility: "public",
    input: workspaceMemberRoleUpdateActionInput,
    output: workspaceMembersOutput,
    permission: ["workspace.members.manage"],
    idempotency: "optional",
    audit: {
      actionName: "workspace.member.role.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.workspaceMembersService.updateMemberRole(resolveWorkspace(context, input), input);
    }
  },
  {
    id: "workspace.invites.list",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    visibility: "public",
    input: workspaceScopeActionInput,
    output: workspaceInvitesOutput,
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
    visibility: "public",
    input: workspaceInviteCreateActionInput,
    output: workspaceInvitesOutput,
    permission: ["workspace.members.invite"],
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.create"
    },
    observability: {},
    assistantTool: {
      description: "Invite a person to the workspace.",
      inputJsonSchema: workspaceInviteCreateActionInput.schema
    },
    async execute(input, context, deps) {
      return deps.workspaceMembersService.createInvite(
        resolveWorkspace(context, input),
        resolveUser(context, input),
        input
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
    input: workspaceInviteRevokeActionInput,
    output: workspaceInvitesOutput,
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
