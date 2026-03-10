import { Type } from "@fastify/type-provider-typebox";
import {
  membershipSummarySchema,
  workspaceSchema as workspaceResourceSchema,
  workspaceSummarySchema
} from "../../../shared/contracts/resources/workspaceSchema.js";
import {
  workspaceSettingsSchema as workspaceSettingsResourceSchema
} from "../../../shared/schemas/resources/workspaceSettingsSchema.js";
import { workspaceMemberSchema as workspaceMemberResourceSchema } from "../../../shared/contracts/resources/workspaceMemberSchema.js";
import { workspaceInviteSchema as workspaceInviteResourceSchema } from "../../../shared/contracts/resources/workspaceInviteSchema.js";
import { workspaceInviteRedeemCommand } from "../../../shared/contracts/commands/workspaceInviteRedeemCommand.js";

const workspaceRoutesContract = Object.freeze({
  body: {
    redeemInvite: workspaceInviteRedeemCommand.operation.body.schema,
    memberRoleUpdate: Type.Object(
      {
        roleId: workspaceMemberResourceSchema.operations.patch.body.schema.properties.roleId
      },
      { additionalProperties: false }
    ),
    createInvite: workspaceInviteResourceSchema.operations.create.body.schema
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
    workspacesList: workspaceResourceSchema.operations.list.response.schema,
    pendingInvites: Type.Object(
      {
        pendingInvites: Type.Array(Type.Object({}, { additionalProperties: true }))
      },
      { additionalProperties: false }
    ),
    respondToInvite: workspaceInviteRedeemCommand.operation.response.schema,
    roles: Type.Object(
      {
        collaborationEnabled: Type.Boolean(),
        defaultInviteRole: Type.String({ minLength: 1 }),
        roles: Type.Array(Type.Object({}, { additionalProperties: true })),
        assignableRoleIds: Type.Array(Type.String({ minLength: 1 }))
      },
      { additionalProperties: true }
    ),
    members: workspaceMemberResourceSchema.operations.list.response.schema,
    invites: workspaceInviteResourceSchema.operations.list.response.schema
  },
  resources: {
    workspace: workspaceResourceSchema,
    workspaceSettings: workspaceSettingsResourceSchema,
    workspaceMember: workspaceMemberResourceSchema,
    workspaceInvite: workspaceInviteResourceSchema
  },
  commands: {
    "workspace.invite.redeem": workspaceInviteRedeemCommand
  }
});

export { workspaceRoutesContract };
