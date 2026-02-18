import { Type } from "@fastify/type-provider-typebox";
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_EMAIL_MIN_LENGTH,
  AUTH_EMAIL_PATTERN
} from "../../../shared/auth/authConstraints.js";
import {
  SETTINGS_CURRENCY_CODE_PATTERN,
  SETTINGS_DATE_FORMAT_OPTIONS,
  SETTINGS_LOCALE_PATTERN,
  SETTINGS_MODE_OPTIONS,
  SETTINGS_NUMBER_FORMAT_OPTIONS,
  SETTINGS_THEME_OPTIONS,
  SETTINGS_TIMING_OPTIONS
} from "../../../shared/settings/index.js";
import { AVATAR_MAX_SIZE, AVATAR_MIN_SIZE } from "../../../shared/avatar/index.js";
import { enumSchema } from "../api/schemas.js";

const WORKSPACE_COLOR_PATTERN = "^#[0-9A-Fa-f]{6}$";

const workspaceSummarySchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    slug: Type.String({ minLength: 1, maxLength: 120 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    color: Type.String({ minLength: 7, maxLength: 7, pattern: WORKSPACE_COLOR_PATTERN }),
    avatarUrl: Type.String(),
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    isAccessible: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const activeWorkspaceSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    slug: Type.String({ minLength: 1, maxLength: 120 }),
    name: Type.String({ minLength: 1, maxLength: 160 }),
    color: Type.String({ minLength: 7, maxLength: 7, pattern: WORKSPACE_COLOR_PATTERN }),
    avatarUrl: Type.String()
  },
  {
    additionalProperties: false
  }
);

const membershipSummarySchema = Type.Object(
  {
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 })
  },
  {
    additionalProperties: false
  }
);

const workspaceSettingsSummarySchema = Type.Object(
  {
    invitesEnabled: Type.Boolean(),
    invitesAvailable: Type.Boolean(),
    invitesEffective: Type.Boolean(),
    defaultMode: enumSchema(SETTINGS_MODE_OPTIONS),
    defaultTiming: enumSchema(SETTINGS_TIMING_OPTIONS),
    defaultPaymentsPerYear: Type.Integer({ minimum: 1, maximum: 365 }),
    defaultHistoryPageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    appDenyEmails: Type.Optional(
      Type.Array(
        Type.String({
          minLength: AUTH_EMAIL_MIN_LENGTH,
          maxLength: AUTH_EMAIL_MAX_LENGTH,
          pattern: AUTH_EMAIL_PATTERN
        })
      )
    ),
    appDenyUserIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 })))
  },
  {
    additionalProperties: false
  }
);

const pendingInviteSummarySchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    workspaceId: Type.Integer({ minimum: 1 }),
    token: Type.String({ minLength: 16, maxLength: 256 }),
    workspaceSlug: Type.String({ minLength: 1, maxLength: 120 }),
    workspaceName: Type.String({ minLength: 1, maxLength: 160 }),
    workspaceAvatarUrl: Type.String(),
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 }),
    expiresAt: Type.String({ minLength: 1 }),
    invitedByDisplayName: Type.String(),
    invitedByEmail: Type.String()
  },
  {
    additionalProperties: false
  }
);

const roleDescriptorSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    assignable: Type.Boolean(),
    permissions: Type.Array(Type.String({ minLength: 1 }))
  },
  {
    additionalProperties: false
  }
);

const roleCatalogSchema = Type.Object(
  {
    collaborationEnabled: Type.Boolean(),
    defaultInviteRole: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
    roles: Type.Array(roleDescriptorSchema),
    assignableRoleIds: Type.Array(Type.String({ minLength: 1, maxLength: 64 }))
  },
  {
    additionalProperties: false
  }
);

const workspaceSettingsResponseSchema = Type.Object(
  {
    workspace: Type.Object(
      {
        id: Type.Integer({ minimum: 1 }),
        slug: Type.String({ minLength: 1, maxLength: 120 }),
        name: Type.String({ minLength: 1, maxLength: 160 }),
        color: Type.String({ minLength: 7, maxLength: 7, pattern: WORKSPACE_COLOR_PATTERN }),
        avatarUrl: Type.String(),
        ownerUserId: Type.Integer({ minimum: 1 }),
        isPersonal: Type.Boolean()
      },
      {
        additionalProperties: false
      }
    ),
    settings: workspaceSettingsSummarySchema,
    roleCatalog: roleCatalogSchema
  },
  {
    additionalProperties: false
  }
);

const workspaceSettingsUpdateBodySchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    color: Type.Optional(Type.String({ minLength: 7, maxLength: 7, pattern: WORKSPACE_COLOR_PATTERN })),
    avatarUrl: Type.Optional(Type.String()),
    invitesEnabled: Type.Optional(Type.Boolean()),
    defaultMode: Type.Optional(enumSchema(SETTINGS_MODE_OPTIONS)),
    defaultTiming: Type.Optional(enumSchema(SETTINGS_TIMING_OPTIONS)),
    defaultPaymentsPerYear: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
    defaultHistoryPageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    appDenyEmails: Type.Optional(
      Type.Array(
        Type.String({
          minLength: AUTH_EMAIL_MIN_LENGTH,
          maxLength: AUTH_EMAIL_MAX_LENGTH,
          pattern: AUTH_EMAIL_PATTERN
        })
      )
    ),
    appDenyUserIds: Type.Optional(Type.Array(Type.Integer({ minimum: 1 })))
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const workspaceMemberSchema = Type.Object(
  {
    userId: Type.Integer({ minimum: 1 }),
    email: Type.String({ minLength: AUTH_EMAIL_MIN_LENGTH, maxLength: AUTH_EMAIL_MAX_LENGTH }),
    displayName: Type.String(),
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 }),
    isOwner: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const workspaceMembersResponseSchema = Type.Object(
  {
    workspace: Type.Object(
      {
        id: Type.Integer({ minimum: 1 }),
        slug: Type.String({ minLength: 1, maxLength: 120 }),
        name: Type.String({ minLength: 1, maxLength: 160 }),
        avatarUrl: Type.String(),
        ownerUserId: Type.Integer({ minimum: 1 }),
        isPersonal: Type.Boolean()
      },
      {
        additionalProperties: false
      }
    ),
    members: Type.Array(workspaceMemberSchema),
    roleCatalog: roleCatalogSchema
  },
  {
    additionalProperties: false
  }
);

const workspaceMemberRoleUpdateBodySchema = Type.Object(
  {
    roleId: Type.String({ minLength: 1, maxLength: 64 })
  },
  {
    additionalProperties: false
  }
);

const workspaceInviteSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    workspaceId: Type.Integer({ minimum: 1 }),
    email: Type.String({ minLength: AUTH_EMAIL_MIN_LENGTH, maxLength: AUTH_EMAIL_MAX_LENGTH }),
    roleId: Type.String({ minLength: 1, maxLength: 64 }),
    status: Type.String({ minLength: 1, maxLength: 32 }),
    expiresAt: Type.String({ minLength: 1 }),
    invitedByUserId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    invitedByDisplayName: Type.String(),
    invitedByEmail: Type.String(),
    workspace: Type.Union([
      Type.Object(
        {
          id: Type.Integer({ minimum: 1 }),
          slug: Type.String({ minLength: 1, maxLength: 120 }),
          name: Type.String({ minLength: 1, maxLength: 160 }),
          avatarUrl: Type.String()
        },
        {
          additionalProperties: false
        }
      ),
      Type.Null()
    ])
  },
  {
    additionalProperties: false
  }
);

const workspaceInvitesResponseSchema = Type.Object(
  {
    workspace: Type.Object(
      {
        id: Type.Integer({ minimum: 1 }),
        slug: Type.String({ minLength: 1, maxLength: 120 }),
        name: Type.String({ minLength: 1, maxLength: 160 }),
        avatarUrl: Type.String(),
        ownerUserId: Type.Integer({ minimum: 1 }),
        isPersonal: Type.Boolean()
      },
      {
        additionalProperties: false
      }
    ),
    invites: Type.Array(workspaceInviteSchema),
    roleCatalog: roleCatalogSchema,
    createdInvite: Type.Optional(
      Type.Object(
        {
          inviteId: Type.Integer({ minimum: 1 }),
          email: Type.String({ minLength: AUTH_EMAIL_MIN_LENGTH, maxLength: AUTH_EMAIL_MAX_LENGTH }),
          token: Type.String({ minLength: 16, maxLength: 256 })
        },
        {
          additionalProperties: false
        }
      )
    )
  },
  {
    additionalProperties: false
  }
);

const workspaceCreateInviteBodySchema = Type.Object(
  {
    email: Type.String({
      minLength: AUTH_EMAIL_MIN_LENGTH,
      maxLength: AUTH_EMAIL_MAX_LENGTH,
      pattern: AUTH_EMAIL_PATTERN
    }),
    roleId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 }))
  },
  {
    additionalProperties: false
  }
);

const workspaceRolesResponseSchema = Type.Object(
  {
    roleCatalog: roleCatalogSchema
  },
  {
    additionalProperties: false
  }
);

const pendingInvitesResponseSchema = Type.Object(
  {
    pendingInvites: Type.Array(pendingInviteSummarySchema)
  },
  {
    additionalProperties: false
  }
);

const redeemPendingInviteBodySchema = Type.Object(
  {
    token: Type.String({ minLength: 16, maxLength: 256 }),
    decision: enumSchema(["accept", "refuse"])
  },
  {
    additionalProperties: false
  }
);

const respondToPendingInviteResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    decision: enumSchema(["accepted", "refused"]),
    inviteId: Type.Integer({ minimum: 1 }),
    workspace: Type.Union([activeWorkspaceSchema, Type.Null()])
  },
  {
    additionalProperties: false
  }
);

const bootstrapResponseSchema = Type.Object(
  {
    session: Type.Object(
      {
        authenticated: Type.Boolean(),
        userId: Type.Optional(Type.Integer({ minimum: 1 })),
        username: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 120 }), Type.Null()]))
      },
      {
        additionalProperties: false
      }
    ),
    profile: Type.Union([
      Type.Object(
        {
          displayName: Type.String({ minLength: 1, maxLength: 120 }),
          email: Type.String({
            minLength: AUTH_EMAIL_MIN_LENGTH,
            maxLength: AUTH_EMAIL_MAX_LENGTH,
            pattern: AUTH_EMAIL_PATTERN
          }),
          avatar: Type.Union([
            Type.Object(
              {
                uploadedUrl: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
                gravatarUrl: Type.String({ minLength: 1 }),
                effectiveUrl: Type.String({ minLength: 1 }),
                hasUploadedAvatar: Type.Boolean(),
                size: Type.Integer({ minimum: AVATAR_MIN_SIZE, maximum: AVATAR_MAX_SIZE }),
                version: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
              },
              {
                additionalProperties: false
              }
            ),
            Type.Null()
          ])
        },
        {
          additionalProperties: false
        }
      ),
      Type.Null()
    ]),
    app: Type.Object(
      {
        tenancyMode: Type.String({ minLength: 1, maxLength: 32 }),
        features: Type.Object(
          {
            workspaceSwitching: Type.Boolean(),
            workspaceInvites: Type.Boolean(),
            workspaceCreateEnabled: Type.Boolean()
          },
          {
            additionalProperties: false
          }
        )
      },
      {
        additionalProperties: false
      }
    ),
    workspaces: Type.Array(workspaceSummarySchema),
    pendingInvites: Type.Array(pendingInviteSummarySchema),
    activeWorkspace: Type.Union([activeWorkspaceSchema, Type.Null()]),
    membership: Type.Union([membershipSummarySchema, Type.Null()]),
    permissions: Type.Array(Type.String({ minLength: 1 })),
    workspaceSettings: Type.Union([workspaceSettingsSummarySchema, Type.Null()]),
    userSettings: Type.Union([
      Type.Object(
        {
          theme: enumSchema(SETTINGS_THEME_OPTIONS),
          locale: Type.String({ minLength: 2, maxLength: 24, pattern: SETTINGS_LOCALE_PATTERN }),
          timeZone: Type.String({ minLength: 1, maxLength: 64 }),
          dateFormat: enumSchema(SETTINGS_DATE_FORMAT_OPTIONS),
          numberFormat: enumSchema(SETTINGS_NUMBER_FORMAT_OPTIONS),
          currencyCode: Type.String({ pattern: SETTINGS_CURRENCY_CODE_PATTERN }),
          avatarSize: Type.Integer({ minimum: AVATAR_MIN_SIZE, maximum: AVATAR_MAX_SIZE }),
          lastActiveWorkspaceId: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])
        },
        {
          additionalProperties: false
        }
      ),
      Type.Null()
    ])
  },
  {
    additionalProperties: false
  }
);

const workspacesListResponseSchema = Type.Object(
  {
    workspaces: Type.Array(workspaceSummarySchema)
  },
  {
    additionalProperties: false
  }
);

const selectWorkspaceBodySchema = Type.Object(
  {
    workspaceSlug: Type.String({ minLength: 1, maxLength: 160 })
  },
  {
    additionalProperties: false
  }
);

const selectWorkspaceResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    workspace: activeWorkspaceSchema,
    membership: Type.Union([membershipSummarySchema, Type.Null()]),
    permissions: Type.Array(Type.String({ minLength: 1 })),
    workspaceSettings: workspaceSettingsSummarySchema
  },
  {
    additionalProperties: false
  }
);

const inviteIdParamsSchema = Type.Object(
  {
    inviteId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
  },
  {
    additionalProperties: false
  }
);

const memberUserIdParamsSchema = Type.Object(
  {
    memberUserId: Type.String({ minLength: 1, maxLength: 32, pattern: "^[0-9]+$" })
  },
  {
    additionalProperties: false
  }
);

export {
  WORKSPACE_COLOR_PATTERN,
  workspaceSummarySchema,
  activeWorkspaceSchema,
  membershipSummarySchema,
  workspaceSettingsSummarySchema,
  pendingInviteSummarySchema,
  roleDescriptorSchema,
  roleCatalogSchema,
  workspaceSettingsResponseSchema,
  workspaceSettingsUpdateBodySchema,
  workspaceMemberSchema,
  workspaceMembersResponseSchema,
  workspaceMemberRoleUpdateBodySchema,
  workspaceInviteSchema,
  workspaceInvitesResponseSchema,
  workspaceCreateInviteBodySchema,
  workspaceRolesResponseSchema,
  pendingInvitesResponseSchema,
  redeemPendingInviteBodySchema,
  respondToPendingInviteResponseSchema,
  bootstrapResponseSchema,
  workspacesListResponseSchema,
  selectWorkspaceBodySchema,
  selectWorkspaceResponseSchema,
  inviteIdParamsSchema,
  memberUserIdParamsSchema
};
