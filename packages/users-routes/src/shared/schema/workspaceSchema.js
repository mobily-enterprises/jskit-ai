import { Type } from "@fastify/type-provider-typebox";
import {
  createCommandContract,
  createResourceSchemaContract
} from "@jskit-ai/http-runtime/shared/contracts";
import {
  workspaceSettingsCreateSchema,
  workspaceSettingsReplaceSchema,
  workspaceSettingsPatchSchema
} from "@jskit-ai/users-core/shared/workspaceSettingsPatch";

const workspaceSummary = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    slug: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    color: Type.String({ minLength: 7, maxLength: 7 }),
    avatarUrl: Type.String(),
    roleId: Type.String({ minLength: 1 }),
    isAccessible: Type.Boolean()
  },
  { additionalProperties: false }
);

const workspaceAdminSummary = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    slug: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    ownerUserId: Type.Integer({ minimum: 1 }),
    avatarUrl: Type.String(),
    color: Type.String({ minLength: 7, maxLength: 7 })
  },
  { additionalProperties: false }
);

const membershipSummary = Type.Object(
  {
    workspaceId: Type.Integer({ minimum: 1 }),
    roleId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const appSurfaceAccess = Type.Object(
  {
    denyEmails: Type.Array(Type.String({ minLength: 1 })),
    denyUserIds: Type.Array(Type.Integer({ minimum: 1 }))
  },
  { additionalProperties: false }
);

const workspaceSettings = Type.Object(
  {
    invitesEnabled: Type.Boolean(),
    invitesAvailable: Type.Boolean(),
    invitesEffective: Type.Boolean(),
    appDenyEmails: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    appDenyUserIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))),
    appSurfaceAccess: Type.Optional(appSurfaceAccess)
  },
  { additionalProperties: false }
);

const roleCatalog = Type.Object(
  {
    collaborationEnabled: Type.Boolean(),
    defaultInviteRole: Type.String({ minLength: 1 }),
    roles: Type.Array(Type.Object({}, { additionalProperties: true })),
    assignableRoleIds: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
);

const workspaceSettingsResponse = Type.Object(
  {
    workspace: workspaceAdminSummary,
    settings: workspaceSettings,
    roleCatalog
  },
  { additionalProperties: false }
);

const workspaceWriteCreateSchema = Type.Object(
  {
    slug: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    ownerUserId: Type.Integer({ minimum: 1 }),
    avatarUrl: Type.String(),
    color: Type.String({ minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }),
    isPersonal: Type.Boolean()
  },
  { additionalProperties: false }
);
const workspaceWriteReplaceSchema = workspaceWriteCreateSchema;
const workspaceWritePatchSchema = Type.Partial(workspaceWriteCreateSchema, { additionalProperties: false });

const workspaceMemberRecord = Type.Object(
  {
    userId: Type.Integer({ minimum: 1 }),
    roleId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    displayName: Type.String(),
    email: Type.String({ minLength: 1 }),
    isOwner: Type.Boolean()
  },
  { additionalProperties: false }
);
const workspaceMemberCreateSchema = Type.Object(
  {
    userId: Type.Integer({ minimum: 1 }),
    roleId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);
const workspaceMemberReplaceSchema = workspaceMemberCreateSchema;
const workspaceMemberPatchSchema = Type.Partial(workspaceMemberCreateSchema, { additionalProperties: false });

const workspaceInviteRecord = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    email: Type.String({ minLength: 3 }),
    roleId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    expiresAt: Type.String({ minLength: 1 }),
    invitedByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])
  },
  { additionalProperties: false }
);
const workspaceInviteCreateSchema = Type.Object(
  {
    email: Type.String({ minLength: 3 }),
    roleId: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);
const workspaceInviteReplaceSchema = Type.Object(
  {
    email: Type.String({ minLength: 3 }),
    roleId: Type.String({ minLength: 1 }),
    status: Type.String({ minLength: 1 }),
    expiresAt: Type.String({ minLength: 1 }),
    invitedByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])
  },
  { additionalProperties: false }
);
const workspaceInvitePatchSchema = Type.Partial(workspaceInviteReplaceSchema, { additionalProperties: false });

const workspacesListResponse = Type.Object(
  {
    workspaces: Type.Array(workspaceSummary)
  },
  { additionalProperties: false }
);

const membersListResponse = Type.Object(
  {
    workspace: workspaceAdminSummary,
    members: Type.Array(workspaceMemberRecord),
    roleCatalog
  },
  { additionalProperties: false }
);

const invitesListResponse = Type.Object(
  {
    workspace: workspaceAdminSummary,
    invites: Type.Array(workspaceInviteRecord),
    roleCatalog,
    inviteTokenPreview: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

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
    workspaces: Type.Array(workspaceSummary),
    pendingInvites: Type.Array(Type.Object({}, { additionalProperties: true })),
    activeWorkspace: Type.Union([workspaceSummary, Type.Null()]),
    membership: Type.Union([membershipSummary, Type.Null()]),
    permissions: Type.Array(Type.String()),
    workspaceSettings: Type.Union([workspaceSettings, Type.Null()]),
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

const redeemInviteBody = Type.Object(
  {
    token: Type.String({ minLength: 1 }),
    decision: Type.Union([Type.Literal("accept"), Type.Literal("refuse")])
  },
  { additionalProperties: false }
);

const workspaceResourceContract = createResourceSchemaContract({
  record: workspaceAdminSummary,
  create: workspaceWriteCreateSchema,
  replace: workspaceWriteReplaceSchema,
  patch: workspaceWritePatchSchema,
  list: workspacesListResponse,
  listItem: workspaceSummary
});

const workspaceSettingsResourceContract = createResourceSchemaContract({
  record: workspaceSettingsResponse,
  create: workspaceSettingsCreateSchema,
  replace: workspaceSettingsReplaceSchema,
  patch: workspaceSettingsPatchSchema
});

const workspaceMemberResourceContract = createResourceSchemaContract({
  record: workspaceMemberRecord,
  create: workspaceMemberCreateSchema,
  replace: workspaceMemberReplaceSchema,
  patch: workspaceMemberPatchSchema,
  list: membersListResponse
});

const workspaceInviteResourceContract = createResourceSchemaContract({
  record: workspaceInviteRecord,
  create: workspaceInviteCreateSchema,
  replace: workspaceInviteReplaceSchema,
  patch: workspaceInvitePatchSchema,
  list: invitesListResponse
});

const workspaceInviteRedeemCommandContract = createCommandContract({
  input: redeemInviteBody,
  output: Type.Object({}, { additionalProperties: true }),
  idempotent: false,
  invalidates: ["workspace.invitations.pending.list", "workspace.workspaces.list", "workspace.bootstrap.read"]
});

const memberRoleUpdateBody = Type.Object(
  {
    roleId: workspaceMemberResourceContract.patch.properties.roleId
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

const schema = Object.freeze({
  query: {
    bootstrap: bootstrapQuery
  },
  body: {
    redeemInvite: workspaceInviteRedeemCommandContract.input,
    memberRoleUpdate: memberRoleUpdateBody,
    settingsUpdate: workspaceSettingsResourceContract.patch,
    createInvite: workspaceInviteResourceContract.create
  },
  params: {
    workspace: workspaceParams,
    member: memberParams,
    invite: inviteParams
  },
  response: {
    bootstrap: bootstrapResponse,
    workspacesList: workspaceResourceContract.list,
    pendingInvites: pendingInvitesResponse,
    respondToInvite: workspaceInviteRedeemCommandContract.output,
    roles: Type.Object({}, { additionalProperties: true }),
    settings: workspaceSettingsResourceContract.record,
    members: workspaceMemberResourceContract.list,
    invites: workspaceInviteResourceContract.list
  },
  resourceContracts: {
    workspace: workspaceResourceContract,
    workspaceSettings: workspaceSettingsResourceContract,
    workspaceMember: workspaceMemberResourceContract,
    workspaceInvite: workspaceInviteResourceContract
  },
  commandContracts: {
    "workspace.invite.redeem": workspaceInviteRedeemCommandContract
  }
});

export { schema };
