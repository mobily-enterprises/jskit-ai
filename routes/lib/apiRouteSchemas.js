import { Type } from "@fastify/type-provider-typebox";
import { HistoryEntrySchema } from "../../lib/schemas/historyEntrySchema.js";
import { createPaginationQuerySchema } from "../../lib/schemas/paginationQuerySchema.js";
import {
  AUTH_ACCESS_TOKEN_MAX_LENGTH,
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_EMAIL_MIN_LENGTH,
  AUTH_EMAIL_PATTERN,
  AUTH_LOGIN_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  AUTH_RECOVERY_TOKEN_MAX_LENGTH,
  AUTH_REFRESH_TOKEN_MAX_LENGTH
} from "../../shared/auth/authConstraints.js";
import { AUTH_METHOD_IDS, AUTH_METHOD_KINDS, AUTH_METHOD_PASSWORD_PROVIDER } from "../../shared/auth/authMethods.js";
import { AUTH_OAUTH_PROVIDERS } from "../../shared/auth/oauthProviders.js";
import {
  SETTINGS_CURRENCY_CODE_PATTERN,
  SETTINGS_DATE_FORMAT_OPTIONS,
  SETTINGS_LOCALE_PATTERN,
  SETTINGS_MODE_OPTIONS,
  SETTINGS_NUMBER_FORMAT_OPTIONS,
  SETTINGS_THEME_OPTIONS,
  SETTINGS_TIMING_OPTIONS
} from "../../shared/settings/index.js";
import { AVATAR_MAX_SIZE, AVATAR_MIN_SIZE } from "../../shared/avatar/index.js";

const registerCredentialsSchema = Type.Object(
  {
    email: Type.String({
      minLength: AUTH_EMAIL_MIN_LENGTH,
      maxLength: AUTH_EMAIL_MAX_LENGTH,
      pattern: AUTH_EMAIL_PATTERN
    }),
    password: Type.String({ minLength: AUTH_PASSWORD_MIN_LENGTH, maxLength: AUTH_PASSWORD_MAX_LENGTH })
  },
  {
    additionalProperties: false
  }
);

const loginCredentialsSchema = Type.Object(
  {
    email: Type.String({
      minLength: AUTH_EMAIL_MIN_LENGTH,
      maxLength: AUTH_EMAIL_MAX_LENGTH,
      pattern: AUTH_EMAIL_PATTERN
    }),
    password: Type.String({ minLength: 1, maxLength: AUTH_LOGIN_PASSWORD_MAX_LENGTH })
  },
  {
    additionalProperties: false
  }
);

const otpLoginVerifyBodySchema = Type.Object(
  {
    email: Type.Optional(
      Type.String({
        minLength: AUTH_EMAIL_MIN_LENGTH,
        maxLength: AUTH_EMAIL_MAX_LENGTH,
        pattern: AUTH_EMAIL_PATTERN
      })
    ),
    token: Type.Optional(Type.String({ minLength: 1, maxLength: AUTH_RECOVERY_TOKEN_MAX_LENGTH })),
    tokenHash: Type.Optional(Type.String({ minLength: 1, maxLength: AUTH_RECOVERY_TOKEN_MAX_LENGTH })),
    type: Type.Optional(Type.Literal("email"))
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const oauthProviderEnumSchema = enumSchema(AUTH_OAUTH_PROVIDERS);
const authMethodIdEnumSchema = enumSchema(AUTH_METHOD_IDS);
const authMethodKindEnumSchema = enumSchema(AUTH_METHOD_KINDS);
const oauthReturnToSchema = Type.String({
  minLength: 1,
  maxLength: 1024,
  pattern: "^/(?!/).*$"
});

const oauthStartParamsSchema = Type.Object(
  {
    provider: oauthProviderEnumSchema
  },
  {
    additionalProperties: false
  }
);

const oauthStartQuerySchema = Type.Object(
  {
    returnTo: Type.Optional(oauthReturnToSchema)
  },
  {
    additionalProperties: false
  }
);

const oauthCompleteBodySchema = Type.Object(
  {
    provider: oauthProviderEnumSchema,
    code: Type.Optional(Type.String({ minLength: 1, maxLength: AUTH_RECOVERY_TOKEN_MAX_LENGTH })),
    accessToken: Type.Optional(Type.String({ minLength: 1, maxLength: AUTH_ACCESS_TOKEN_MAX_LENGTH })),
    refreshToken: Type.Optional(Type.String({ minLength: 1, maxLength: AUTH_REFRESH_TOKEN_MAX_LENGTH })),
    error: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    errorDescription: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 }))
  },
  {
    additionalProperties: false
  }
);

const emailOnlySchema = Type.Object(
  {
    email: Type.String({
      minLength: AUTH_EMAIL_MIN_LENGTH,
      maxLength: AUTH_EMAIL_MAX_LENGTH,
      pattern: AUTH_EMAIL_PATTERN
    })
  },
  {
    additionalProperties: false
  }
);

const passwordOnlySchema = Type.Object(
  {
    password: Type.String({ minLength: AUTH_PASSWORD_MIN_LENGTH, maxLength: AUTH_PASSWORD_MAX_LENGTH })
  },
  {
    additionalProperties: false
  }
);

const passwordMethodToggleBodySchema = Type.Object(
  {
    enabled: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const passwordRecoverySchema = Type.Object(
  {
    code: Type.Optional(Type.String({ minLength: 1, maxLength: AUTH_RECOVERY_TOKEN_MAX_LENGTH })),
    tokenHash: Type.Optional(Type.String({ minLength: 1, maxLength: AUTH_RECOVERY_TOKEN_MAX_LENGTH })),
    accessToken: Type.Optional(Type.String({ minLength: 1, maxLength: AUTH_ACCESS_TOKEN_MAX_LENGTH })),
    refreshToken: Type.Optional(Type.String({ minLength: 1, maxLength: AUTH_REFRESH_TOKEN_MAX_LENGTH })),
    type: Type.Optional(Type.Literal("recovery"))
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const okResponseSchema = Type.Object(
  {
    ok: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const okMessageResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    message: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
);

const registerResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    requiresEmailConfirmation: Type.Boolean(),
    username: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    message: Type.Optional(Type.String({ minLength: 1 }))
  },
  {
    additionalProperties: false
  }
);

const loginResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    username: Type.String({ minLength: 1, maxLength: 120 })
  },
  {
    additionalProperties: false
  }
);

const otpLoginVerifyResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    username: Type.String({ minLength: 1, maxLength: 120 }),
    email: Type.String({
      minLength: AUTH_EMAIL_MIN_LENGTH,
      maxLength: AUTH_EMAIL_MAX_LENGTH,
      pattern: AUTH_EMAIL_PATTERN
    })
  },
  {
    additionalProperties: false
  }
);

const oauthCompleteResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    provider: oauthProviderEnumSchema,
    username: Type.String({ minLength: 1, maxLength: 120 }),
    email: Type.String({
      minLength: AUTH_EMAIL_MIN_LENGTH,
      maxLength: AUTH_EMAIL_MAX_LENGTH,
      pattern: AUTH_EMAIL_PATTERN
    })
  },
  {
    additionalProperties: false
  }
);

const logoutResponseSchema = Type.Object(
  {
    ok: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const sessionResponseSchema = Type.Object(
  {
    authenticated: Type.Boolean(),
    username: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    csrfToken: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
);

const sessionErrorResponseSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    csrfToken: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
);

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

const fieldErrorsSchema = Type.Record(Type.String(), Type.String());

const apiErrorDetailsSchema = Type.Object(
  {
    fieldErrors: Type.Optional(fieldErrorsSchema)
  },
  {
    additionalProperties: true
  }
);

const apiErrorResponseSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    details: Type.Optional(apiErrorDetailsSchema),
    fieldErrors: Type.Optional(fieldErrorsSchema)
  },
  {
    additionalProperties: false
  }
);

const apiValidationErrorResponseSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    fieldErrors: fieldErrorsSchema,
    details: Type.Object(
      {
        fieldErrors: fieldErrorsSchema
      },
      {
        additionalProperties: true
      }
    )
  },
  {
    additionalProperties: false
  }
);

const fastifyDefaultErrorResponseSchema = Type.Object(
  {
    statusCode: Type.Integer({ minimum: 400, maximum: 599 }),
    error: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    code: Type.Optional(Type.String({ minLength: 1 })),
    details: Type.Optional(Type.Unknown()),
    fieldErrors: Type.Optional(fieldErrorsSchema)
  },
  {
    additionalProperties: true
  }
);

const STANDARD_ERROR_STATUS_CODES = [400, 401, 403, 404, 409, 422, 429, 500, 503];

function withStandardErrorResponses(successResponses, { includeValidation400 = false } = {}) {
  const responses = {
    ...successResponses
  };

  for (const statusCode of STANDARD_ERROR_STATUS_CODES) {
    if (responses[statusCode]) {
      continue;
    }

    if (statusCode === 400 && includeValidation400) {
      responses[statusCode] = Type.Union([
        apiValidationErrorResponseSchema,
        apiErrorResponseSchema,
        fastifyDefaultErrorResponseSchema
      ]);
      continue;
    }

    responses[statusCode] = Type.Union([apiErrorResponseSchema, fastifyDefaultErrorResponseSchema]);
  }

  return responses;
}

function enumSchema(values) {
  return Type.Union(values.map((value) => Type.Literal(value)));
}

const historyQuerySchema = createPaginationQuerySchema({
  defaultPage: 1,
  defaultPageSize: 10,
  maxPageSize: 100
});

const historyEntryWithUsernameSchema = Type.Object(
  {
    ...HistoryEntrySchema.properties,
    username: Type.String({ minLength: 1, maxLength: 120 })
  },
  {
    additionalProperties: false
  }
);

const historyListResponseSchema = Type.Object(
  {
    entries: Type.Array(historyEntryWithUsernameSchema),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 1 })
  },
  {
    additionalProperties: false
  }
);

const settingsAvatarSchema = Type.Object(
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
);

const settingsProfileSchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 120 }),
    email: Type.String({
      minLength: AUTH_EMAIL_MIN_LENGTH,
      maxLength: AUTH_EMAIL_MAX_LENGTH,
      pattern: AUTH_EMAIL_PATTERN
    }),
    emailManagedBy: Type.Literal("supabase"),
    emailChangeFlow: Type.Literal("supabase"),
    avatar: settingsAvatarSchema
  },
  {
    additionalProperties: false
  }
);

const authMethodProviderSchema = Type.Union([
  Type.Literal(AUTH_METHOD_PASSWORD_PROVIDER),
  ...AUTH_OAUTH_PROVIDERS.map((provider) => Type.Literal(provider))
]);

const settingsSecuritySchema = Type.Object(
  {
    mfa: Type.Object(
      {
        status: Type.String({ minLength: 1, maxLength: 64 }),
        enrolled: Type.Boolean(),
        methods: Type.Array(Type.String({ minLength: 1, maxLength: 64 }))
      },
      { additionalProperties: false }
    ),
    sessions: Type.Object(
      {
        canSignOutOtherDevices: Type.Boolean()
      },
      { additionalProperties: false }
    ),
    authPolicy: Type.Object(
      {
        minimumEnabledMethods: Type.Integer({ minimum: 1 }),
        enabledMethodsCount: Type.Integer({ minimum: 0 })
      },
      { additionalProperties: false }
    ),
    authMethods: Type.Array(
      Type.Object(
        {
          id: authMethodIdEnumSchema,
          kind: authMethodKindEnumSchema,
          provider: Type.Union([authMethodProviderSchema, Type.Null()]),
          label: Type.String({ minLength: 1 }),
          configured: Type.Boolean(),
          enabled: Type.Boolean(),
          canEnable: Type.Boolean(),
          canDisable: Type.Boolean(),
          supportsSecretUpdate: Type.Boolean(),
          requiresCurrentPassword: Type.Boolean()
        },
        { additionalProperties: false }
      )
    )
  },
  {
    additionalProperties: false
  }
);

const settingsPreferencesSchema = Type.Object(
  {
    theme: enumSchema(SETTINGS_THEME_OPTIONS),
    locale: Type.String({ minLength: 2, maxLength: 24, pattern: SETTINGS_LOCALE_PATTERN }),
    timeZone: Type.String({ minLength: 1, maxLength: 64 }),
    dateFormat: enumSchema(SETTINGS_DATE_FORMAT_OPTIONS),
    numberFormat: enumSchema(SETTINGS_NUMBER_FORMAT_OPTIONS),
    currencyCode: Type.String({ pattern: SETTINGS_CURRENCY_CODE_PATTERN }),
    avatarSize: Type.Integer({ minimum: AVATAR_MIN_SIZE, maximum: AVATAR_MAX_SIZE })
  },
  {
    additionalProperties: false
  }
);

const settingsNotificationsSchema = Type.Object(
  {
    productUpdates: Type.Boolean(),
    accountActivity: Type.Boolean(),
    securityAlerts: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const settingsResponseSchema = Type.Object(
  {
    profile: settingsProfileSchema,
    security: settingsSecuritySchema,
    preferences: settingsPreferencesSchema,
    notifications: settingsNotificationsSchema
  },
  {
    additionalProperties: false
  }
);

const settingsProfileUpdateBodySchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 120 })
  },
  {
    additionalProperties: false
  }
);

const settingsPreferencesUpdateBodySchema = Type.Object(
  {
    theme: Type.Optional(enumSchema(SETTINGS_THEME_OPTIONS)),
    locale: Type.Optional(Type.String({ minLength: 2, maxLength: 24, pattern: SETTINGS_LOCALE_PATTERN })),
    timeZone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    dateFormat: Type.Optional(enumSchema(SETTINGS_DATE_FORMAT_OPTIONS)),
    numberFormat: Type.Optional(enumSchema(SETTINGS_NUMBER_FORMAT_OPTIONS)),
    currencyCode: Type.Optional(Type.String({ pattern: SETTINGS_CURRENCY_CODE_PATTERN })),
    avatarSize: Type.Optional(Type.Integer({ minimum: AVATAR_MIN_SIZE, maximum: AVATAR_MAX_SIZE }))
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const settingsNotificationsUpdateBodySchema = Type.Object(
  {
    productUpdates: Type.Optional(Type.Boolean()),
    accountActivity: Type.Optional(Type.Boolean()),
    securityAlerts: Type.Optional(Type.Boolean())
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const changePasswordBodySchema = Type.Object(
  {
    currentPassword: Type.Optional(Type.String({ minLength: 1, maxLength: AUTH_LOGIN_PASSWORD_MAX_LENGTH })),
    newPassword: Type.String({ minLength: AUTH_PASSWORD_MIN_LENGTH, maxLength: AUTH_PASSWORD_MAX_LENGTH }),
    confirmPassword: Type.String({ minLength: 1, maxLength: AUTH_PASSWORD_MAX_LENGTH })
  },
  {
    additionalProperties: false
  }
);

export {
  registerCredentialsSchema,
  loginCredentialsSchema,
  otpLoginVerifyBodySchema,
  oauthProviderEnumSchema,
  authMethodIdEnumSchema,
  authMethodKindEnumSchema,
  oauthReturnToSchema,
  oauthStartParamsSchema,
  oauthStartQuerySchema,
  oauthCompleteBodySchema,
  emailOnlySchema,
  passwordOnlySchema,
  passwordMethodToggleBodySchema,
  passwordRecoverySchema,
  okResponseSchema,
  okMessageResponseSchema,
  registerResponseSchema,
  loginResponseSchema,
  otpLoginVerifyResponseSchema,
  oauthCompleteResponseSchema,
  logoutResponseSchema,
  sessionResponseSchema,
  sessionErrorResponseSchema,
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
  memberUserIdParamsSchema,
  fieldErrorsSchema,
  apiErrorDetailsSchema,
  apiErrorResponseSchema,
  apiValidationErrorResponseSchema,
  fastifyDefaultErrorResponseSchema,
  STANDARD_ERROR_STATUS_CODES,
  withStandardErrorResponses,
  enumSchema,
  historyQuerySchema,
  historyEntryWithUsernameSchema,
  historyListResponseSchema,
  settingsAvatarSchema,
  settingsProfileSchema,
  authMethodProviderSchema,
  settingsSecuritySchema,
  settingsPreferencesSchema,
  settingsNotificationsSchema,
  settingsResponseSchema,
  settingsProfileUpdateBodySchema,
  settingsPreferencesUpdateBodySchema,
  settingsNotificationsUpdateBodySchema,
  changePasswordBodySchema
};
