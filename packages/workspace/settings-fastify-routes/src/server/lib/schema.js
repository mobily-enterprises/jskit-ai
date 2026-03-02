import { Type } from "@fastify/type-provider-typebox";
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_EMAIL_MIN_LENGTH,
  AUTH_EMAIL_PATTERN,
  AUTH_LOGIN_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH
} from "@jskit-ai/access-core/authConstraints";
import { OAUTH_PROVIDER_ID_PATTERN } from "@jskit-ai/access-core/oauthProviders";
import {
  PLATFORM_AVATAR_SETTINGS,
  SETTINGS_CURRENCY_CODE_PATTERN,
  SETTINGS_DATE_FORMAT_OPTIONS,
  SETTINGS_FIELD_SPECS,
  SETTINGS_LOCALE_PATTERN,
  SETTINGS_NUMBER_FORMAT_OPTIONS,
  SETTINGS_THEME_OPTIONS
} from "@jskit-ai/workspace-console-core/settingsModel";
import { schema as authSchema } from "@jskit-ai/auth-web/server";
import { enumSchema } from "@jskit-ai/http-contracts/errorResponses";
import { buildSchema } from "@jskit-ai/workspace-console-core/settingsSchemaBuilder";

const AVATAR_MIN_SIZE = PLATFORM_AVATAR_SETTINGS.minSize;
const AVATAR_MAX_SIZE = PLATFORM_AVATAR_SETTINGS.maxSize;

const avatar = Type.Object(
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

const AUTH_PROVIDER_ID_PATTERN = "^[a-z][a-z0-9_-]{1,63}$";

const profile = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 120 }),
    email: Type.String({
      minLength: AUTH_EMAIL_MIN_LENGTH,
      maxLength: AUTH_EMAIL_MAX_LENGTH,
      pattern: AUTH_EMAIL_PATTERN
    }),
    emailManagedBy: Type.String({ minLength: 2, maxLength: 64, pattern: AUTH_PROVIDER_ID_PATTERN }),
    emailChangeFlow: Type.String({ minLength: 2, maxLength: 64, pattern: AUTH_PROVIDER_ID_PATTERN }),
    avatar
  },
  {
    additionalProperties: false
  }
);

const authMethodProvider = Type.String({
  minLength: 2,
  maxLength: 32,
  pattern: OAUTH_PROVIDER_ID_PATTERN
});

const security = Type.Object(
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
          id: authSchema.fields.authMethodId,
          kind: authSchema.fields.authMethodKind,
          provider: Type.Union([authMethodProvider, Type.Null()]),
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

const preferences = Type.Object(
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

const notifications = Type.Object(
  {
    productUpdates: Type.Boolean(),
    accountActivity: Type.Boolean(),
    securityAlerts: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const chat = Type.Object(
  {
    publicChatId: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
    allowWorkspaceDms: Type.Boolean(),
    allowGlobalDms: Type.Boolean(),
    requireSharedWorkspaceForGlobalDm: Type.Boolean(),
    discoverableByPublicChatId: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const response = Type.Object(
  {
    profile,
    security,
    preferences,
    notifications,
    chat
  },
  {
    additionalProperties: false
  }
);

const profileUpdate = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 120 })
  },
  {
    additionalProperties: false
  }
);

const preferencesUpdate = buildSchema({
  fieldSpecs: SETTINGS_FIELD_SPECS.preferences,
  mode: "patch"
});

const notificationsUpdate = buildSchema({
  fieldSpecs: SETTINGS_FIELD_SPECS.notifications,
  mode: "patch"
});

const chatUpdate = buildSchema({
  fieldSpecs: SETTINGS_FIELD_SPECS.chat,
  mode: "patch"
});

const changePassword = Type.Object(
  {
    currentPassword: Type.Optional(Type.String({ minLength: 1, maxLength: AUTH_LOGIN_PASSWORD_MAX_LENGTH })),
    newPassword: Type.String({ minLength: AUTH_PASSWORD_MIN_LENGTH, maxLength: AUTH_PASSWORD_MAX_LENGTH }),
    confirmPassword: Type.String({ minLength: 1, maxLength: AUTH_PASSWORD_MAX_LENGTH })
  },
  {
    additionalProperties: false
  }
);

const schema = {
  avatar,
  profile,
  authMethodProvider,
  security,
  preferences,
  notifications,
  chat,
  response,
  body: {
    profile: profileUpdate,
    preferences: preferencesUpdate,
    notifications: notificationsUpdate,
    chat: chatUpdate,
    changePassword
  }
};

export { schema };
