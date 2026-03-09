import { Type } from "@fastify/type-provider-typebox";
import {
  membershipSummarySchema,
  roleCatalogSchema,
  workspaceSchema as workspaceResourceSchema,
  workspaceSummarySchema
} from "@jskit-ai/users-core/shared/contracts/resources/workspaceSchema";
import {
  workspaceSettingsSchema as workspaceSettingsResourceSchema,
  workspaceSettingsValueSchema
} from "@jskit-ai/users-core/shared/contracts/resources/workspaceSettingsSchema";
import { workspaceMemberSchema as workspaceMemberResourceSchema } from "@jskit-ai/users-core/shared/contracts/resources/workspaceMemberSchema";
import { workspaceInviteSchema as workspaceInviteResourceSchema } from "@jskit-ai/users-core/shared/contracts/resources/workspaceInviteSchema";
import { workspaceInviteRedeemCommand } from "@jskit-ai/users-core/shared/contracts/commands/workspaceInviteRedeemCommand";

const bootstrapResponse = Type.Object(
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
    workspaceSettings: Type.Union([workspaceSettingsValueSchema, Type.Null()]),
    userSettings: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()])
  },
  { additionalProperties: true }
);

const bootstrapQuery = Type.Object(
  {
    workspaceSlug: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const pendingInvitesResponse = Type.Object(
  {
    pendingInvites: Type.Array(Type.Object({}, { additionalProperties: true }))
  },
  { additionalProperties: false }
);

const memberRoleUpdateBody = Type.Object(
  {
    roleId: workspaceMemberResourceSchema.operations.patch.body.schema.properties.roleId
  },
  { additionalProperties: false }
);

const memberParams = Type.Object(
  {
    workspaceSlug: Type.String({ minLength: 1 }),
    memberUserId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const inviteParams = Type.Object(
  {
    workspaceSlug: Type.String({ minLength: 1 }),
    inviteId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const workspaceParams = Type.Object(
  {
    workspaceSlug: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const workspaceRoutesContract = Object.freeze({
  query: {
    bootstrap: bootstrapQuery
  },
  body: {
    redeemInvite: workspaceInviteRedeemCommand.operation.body.schema,
    memberRoleUpdate: memberRoleUpdateBody,
    settingsUpdate: workspaceSettingsResourceSchema.operations.patch.body.schema,
    createInvite: workspaceInviteResourceSchema.operations.create.body.schema
  },
  params: {
    workspace: workspaceParams,
    member: memberParams,
    invite: inviteParams
  },
  response: {
    bootstrap: bootstrapResponse,
    workspacesList: workspaceResourceSchema.operations.list.response.schema,
    pendingInvites: pendingInvitesResponse,
    respondToInvite: workspaceInviteRedeemCommand.operation.response.schema,
    roles: roleCatalogSchema,
    settings: workspaceSettingsResourceSchema.operations.view.response.schema,
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
