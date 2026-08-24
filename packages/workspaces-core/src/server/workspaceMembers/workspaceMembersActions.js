import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { resolveWorkspace } from "../support/resolveWorkspace.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";
import { workspaceMembersResource } from "../../shared/resources/workspaceMembersResource.js";
import {
  INVITE_RECIPIENT_BOOTSTRAP_AUDIENCE,
  createWorkspaceEntityAndBootstrapEvents
} from "../common/support/realtimeServiceEvents.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";

const WORKSPACE_MEMBER_CHANGED_EVENTS = createWorkspaceEntityAndBootstrapEvents({
  workspaceEntity: "member",
  workspaceOperation: "updated",
  workspaceRealtimeEvent: "workspace.members.changed"
});

const WORKSPACE_INVITE_CREATED_EVENTS = createWorkspaceEntityAndBootstrapEvents({
  workspaceEntity: "invite",
  workspaceOperation: "created",
  workspaceRealtimeEvent: "workspace.invites.changed",
  bootstrapEntityId: ({ result } = {}) => result?.value?.createdInviteId,
  bootstrapAudience: INVITE_RECIPIENT_BOOTSTRAP_AUDIENCE
});

const WORKSPACE_INVITE_REVOKED_EVENTS = createWorkspaceEntityAndBootstrapEvents({
  workspaceEntity: "invite",
  workspaceOperation: "updated",
  workspaceRealtimeEvent: "workspace.invites.changed",
  bootstrapEntityId: ({ result } = {}) => result?.value?.revokedInviteId,
  bootstrapAudience: INVITE_RECIPIENT_BOOTSTRAP_AUDIENCE
});

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

const workspaceMembersActionSpecifications = Object.freeze([
  {
    id: "workspace.roles.list",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["*"],
    permission: {
      require: "all",
      permissions: ["workspace.roles.view"]
    },
    input: workspaceSlugParamsValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: "workspace.roles.list"
    },
    observability: {},
    async run(workspaceMembersService, _input, context) {
      return returnJsonApiData(await workspaceMembersService.listRoles({ context }));
    }
  },
  {
    id: "workspace.members.list",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["*"],
    permission: {
      require: "all",
      permissions: ["workspace.members.view"]
    },
    input: workspaceSlugParamsValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: "workspace.members.list"
    },
    observability: {},
    async run(workspaceMembersService, input, context) {
      return returnJsonApiData(await workspaceMembersService.listMembers(resolveWorkspace(context, input), {
        context
      }));
    }
  },
  {
    id: "workspace.member.role.update",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["*"],
    permission: {
      require: "all",
      permissions: ["workspace.members.manage"]
    },
    input: updateMemberRoleActionInput,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: "workspace.member.role.update"
    },
    observability: {},
    events: WORKSPACE_MEMBER_CHANGED_EVENTS,
    async run(workspaceMembersService, input, context) {
      return returnJsonApiData(await workspaceMembersService.updateMemberRole(resolveWorkspace(context, input), {
        memberUserId: input.memberUserId,
        roleSid: input.roleSid
      }, {
        context
      }));
    }
  },
  {
    id: "workspace.member.remove",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["*"],
    permission: {
      require: "all",
      permissions: ["workspace.members.manage"]
    },
    input: removeMemberActionInput,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: "workspace.member.remove"
    },
    observability: {},
    events: WORKSPACE_MEMBER_CHANGED_EVENTS,
    async run(workspaceMembersService, input, context) {
      return returnJsonApiData(await workspaceMembersService.removeMember(resolveWorkspace(context, input), {
        memberUserId: input.memberUserId
      }, {
        context
      }));
    }
  },
  {
    id: "workspace.invites.list",
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["*"],
    permission: {
      require: "all",
      permissions: ["workspace.members.view"]
    },
    input: workspaceSlugParamsValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: "workspace.invites.list"
    },
    observability: {},
    async run(workspaceMembersService, input, context) {
      return returnJsonApiData(await workspaceMembersService.listInvites(resolveWorkspace(context, input), {
        context
      }));
    }
  },
  {
    id: "workspace.invite.create",
    version: 1,
    kind: "command",
    channels: ["api", "assistant_tool", "automation", "internal"],
    surfaces: ["*"],
    permission: {
      require: "all",
      permissions: ["workspace.members.invite"]
    },
    input: createInviteActionInput,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.create"
    },
    observability: {},
    events: WORKSPACE_INVITE_CREATED_EVENTS,
    extensions: {
      assistant: {
        description: "Invite a person to the workspace."
      }
    },
    async run(workspaceMembersService, input, context) {
      return returnJsonApiData(await workspaceMembersService.createInvite(
        resolveWorkspace(context, input),
        resolveActionUser(context, input),
        {
          email: input.email,
          roleSid: input.roleSid
        },
        {
          context
        }
      ));
    }
  },
  {
    id: "workspace.invite.revoke",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["*"],
    permission: {
      require: "all",
      permissions: ["workspace.invites.revoke"]
    },
    input: revokeInviteActionInput,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: "workspace.invite.revoke"
    },
    observability: {},
    events: WORKSPACE_INVITE_REVOKED_EVENTS,
    async run(workspaceMembersService, input, context) {
      return returnJsonApiData(await workspaceMembersService.revokeInvite(resolveWorkspace(context, input), input.inviteId, {
        context
      }));
    }
  }
]);

function buildWorkspaceMembersActions({ workspaceMembersService } = {}) {
  if (!workspaceMembersService) throw new TypeError("buildWorkspaceMembersActions requires workspaceMembersService.");
  return workspaceMembersActionSpecifications.map(({ run, ...definition }) => Object.freeze({
    ...definition,
    execute(input, context) {
      return run(workspaceMembersService, input, context);
    }
  }));
}

export { workspaceMembersActionSpecifications, buildWorkspaceMembersActions };
