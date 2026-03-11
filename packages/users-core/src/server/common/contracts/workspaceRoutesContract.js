import { Type } from "@fastify/type-provider-typebox";
import {
  membershipSummarySchema,
  workspaceResource,
  workspaceSummarySchema
} from "../../../shared/contracts/resources/workspaceResource.js";
import {
  workspaceSettingsResource as workspaceSettingsResourceSchema
} from "../../../shared/schemas/resources/workspaceSettingsResource.js";
import { workspaceMemberResource } from "../../../shared/contracts/resources/workspaceMemberResource.js";
import { workspaceInviteResource } from "../../../shared/contracts/resources/workspaceInviteResource.js";
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
    bootstrap: Type.Object(
      {
        session: Type.Object(
          {
            authenticated: Type.Boolean(),
            userId: Type.Optional(Type.Integer({ minimum: 1 }))
          },
          { additionalProperties: true }
        ),
        profile: Type.Union([
          Type.Object(
            {
              displayName: Type.String(),
              email: Type.String(),
              avatar: Type.Optional(Type.Object({}, { additionalProperties: true }))
            },
            { additionalProperties: true }
          ),
          Type.Null()
        ]),
        app: Type.Object({}, { additionalProperties: true }),
        workspaces: Type.Array(workspaceSummarySchema),
        pendingInvites: Type.Array(Type.Object({}, { additionalProperties: true })),
        activeWorkspace: Type.Union([workspaceSummarySchema, Type.Null()]),
        membership: Type.Union([membershipSummarySchema, Type.Null()]),
        permissions: Type.Array(Type.String()),
        workspaceSettings: Type.Union([
          workspaceSettingsResourceSchema.operations.view.output.schema.properties.settings,
          Type.Null()
        ]),
        userSettings: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()])
      },
      { additionalProperties: true }
    ),
    workspacesList: workspaceResource.operations.list.response.schema,
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
