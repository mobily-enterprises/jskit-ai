import { Type } from "@fastify/type-provider-typebox";
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_EMAIL_MIN_LENGTH,
  AUTH_EMAIL_PATTERN,
  AUTH_LOGIN_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH
} from "../../shared/auth/authConstraints.js";
import { AUTH_METHOD_PASSWORD_PROVIDER } from "../../shared/auth/authMethods.js";
import { AUTH_OAUTH_PROVIDERS } from "../../shared/auth/oauthProviders.js";
import {
  SETTINGS_CURRENCY_CODE_PATTERN,
  SETTINGS_DATE_FORMAT_OPTIONS,
  SETTINGS_LOCALE_PATTERN,
  SETTINGS_NUMBER_FORMAT_OPTIONS,
  SETTINGS_THEME_OPTIONS
} from "../../shared/settings/index.js";
import { AVATAR_MAX_SIZE, AVATAR_MIN_SIZE } from "../../shared/avatar/index.js";
import { authMethodIdEnumSchema, authMethodKindEnumSchema } from "./auth.schemas.js";
import { enumSchema } from "./common.schemas.js";

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
