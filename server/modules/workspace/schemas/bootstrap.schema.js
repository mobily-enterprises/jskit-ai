import { Type } from "@fastify/type-provider-typebox";
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_EMAIL_MIN_LENGTH,
  AUTH_EMAIL_PATTERN
} from "../../../../shared/auth/authConstraints.js";
import {
  SETTINGS_CURRENCY_CODE_PATTERN,
  SETTINGS_DATE_FORMAT_OPTIONS,
  SETTINGS_LOCALE_PATTERN,
  SETTINGS_NUMBER_FORMAT_OPTIONS,
  SETTINGS_THEME_OPTIONS
} from "../../../../shared/settings/index.js";
import { AVATAR_MAX_SIZE, AVATAR_MIN_SIZE } from "../../../../shared/avatar/index.js";
import { enumSchema } from "../../api/schemas.js";
import { schema as sharedSchema } from "./shared.schema.js";

const bootstrap = Type.Object(
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
    workspaces: Type.Array(sharedSchema.summary),
    pendingInvites: Type.Array(sharedSchema.pendingInviteSummary),
    activeWorkspace: Type.Union([sharedSchema.active, Type.Null()]),
    membership: Type.Union([sharedSchema.membershipSummary, Type.Null()]),
    permissions: Type.Array(Type.String({ minLength: 1 })),
    workspaceSettings: Type.Union([sharedSchema.settingsSummary, Type.Null()]),
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

const schema = {
  response: {
    bootstrap
  }
};

export { schema };
