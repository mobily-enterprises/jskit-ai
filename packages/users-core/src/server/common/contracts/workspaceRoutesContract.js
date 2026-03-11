import { Type } from "@fastify/type-provider-typebox";
import { workspaceResource } from "../../../shared/resources/workspaceResource.js";
import { workspaceBootstrapResource } from "../../../shared/schemas/resources/workspaceBootstrapResource.js";
import {
  workspaceSettingsResource as workspaceSettingsResourceSchema
} from "../../../shared/schemas/resources/workspaceSettingsResource.js";
import { workspaceMemberResource } from "../../../shared/resources/workspaceMemberResource.js";
import { workspaceInviteResource } from "../../../shared/resources/workspaceInviteResource.js";
import { workspaceInviteRedeemCommandResource } from "../../../shared/contracts/commands/workspaceInviteRedeemCommandResource.js";

const workspaceRoutesContract = Object.freeze({
  body: {
    redeemInvite: workspaceInviteRedeemCommandResource.operation.body.schema,
    memberRoleUpdate: Type.Object(
      {
        roleId: workspaceMemberResource.operations.patch.body.schema.properties.roleId
      },
      { additionalProperties: false }
    ),
    createInvite: workspaceInviteResource.operations.create.body.schema
  },
  response: {
    bootstrap: workspaceBootstrapResource.operations.view.output.schema,
    workspacesList: workspaceResource.operations.list.output.schema,
    pendingInvites: Type.Object(
      {
        pendingInvites: Type.Array(Type.Object({}, { additionalProperties: true }))
      },
      { additionalProperties: false }
    ),
    respondToInvite: workspaceInviteRedeemCommandResource.operation.output.schema,
    roles: Type.Object(
      {
        collaborationEnabled: Type.Boolean(),
        defaultInviteRole: Type.String({ minLength: 1 }),
        roles: Type.Array(Type.Object({}, { additionalProperties: true })),
        assignableRoleIds: Type.Array(Type.String({ minLength: 1 }))
      },
      { additionalProperties: true }
    ),
    members: workspaceMemberResource.operations.list.response.schema,
    invites: workspaceInviteResource.operations.list.response.schema
  },
  resources: {
    workspace: workspaceResource,
    workspaceSettings: workspaceSettingsResourceSchema,
    workspaceMember: workspaceMemberResource,
    workspaceInvite: workspaceInviteResource
  },
  commands: {
    "workspace.invite.redeem": workspaceInviteRedeemCommandResource
  }
});

export { workspaceRoutesContract };
