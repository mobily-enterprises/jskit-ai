import { workspaceResource } from "../../../shared/resources/workspaceResource.js";
import {
  workspaceSettingsResource
} from "../../../shared/schemas/resources/workspaceSettingsResource.js";
import { workspaceMemberResource } from "../../../shared/resources/workspaceMemberResource.js";
import { workspaceInviteResource } from "../../../shared/resources/workspaceInviteResource.js";
import { workspaceMembersResource } from "../../../shared/schemas/resources/workspaceMembersResource.js";
import { workspacePendingInvitationsResource } from "../../../shared/schemas/resources/workspacePendingInvitationsResource.js";

const workspaceRoutes = Object.freeze({
  body: {
    redeemInvite: workspaceInviteResource.operations.redeem.body.schema,
    memberRoleUpdate: workspaceMembersResource.operations.updateMemberRole.body.schema,
    createInvite: workspaceInviteResource.operations.create.body.schema
  },
  response: {
    workspacesList: workspaceResource.operations.list.output.schema,
    pendingInvites: workspacePendingInvitationsResource.operations.list.output.schema,
    respondToInvite: workspaceInviteResource.operations.redeem.output.schema,
    roles: workspaceMembersResource.operations.rolesList.output.schema,
    members: workspaceMemberResource.operations.list.output.schema,
    invites: workspaceInviteResource.operations.list.output.schema
  },
  resources: {
    workspace: workspaceResource,
    workspaceSettings: workspaceSettingsResource,
    workspaceMember: workspaceMemberResource,
    workspaceInvite: workspaceInviteResource
  }
});

export { workspaceRoutes };
