import { Type } from "@fastify/type-provider-typebox";
import { HistoryEntrySchema } from "../lib/schemas/historyEntrySchema.js";
import { createPaginationQuerySchema } from "../lib/schemas/paginationQuerySchema.js";
import { annuityCalculatorRequestBodySchema } from "../lib/schemas/annuityCalculator.request.js";
import { annuityCalculatorResponseSchema } from "../lib/schemas/annuityCalculator.response.js";
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
} from "../shared/auth/authConstraints.js";
import {
  AUTH_METHOD_IDS,
  AUTH_METHOD_KINDS,
  AUTH_METHOD_PASSWORD_PROVIDER
} from "../shared/auth/authMethods.js";
import { AUTH_OAUTH_PROVIDERS } from "../shared/auth/oauthProviders.js";
import {
  SETTINGS_CURRENCY_CODE_PATTERN,
  SETTINGS_DATE_FORMAT_OPTIONS,
  SETTINGS_LOCALE_PATTERN,
  SETTINGS_MODE_OPTIONS,
  SETTINGS_NUMBER_FORMAT_OPTIONS,
  SETTINGS_THEME_OPTIONS,
  SETTINGS_TIMING_OPTIONS
} from "../shared/settings/index.js";
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_DEFAULT_UPLOAD_DIMENSION,
  AVATAR_MAX_SIZE,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_MIN_SIZE,
  AVATAR_UPLOAD_DIMENSION_OPTIONS
} from "../shared/avatar/index.js";
import { safeRequestUrl } from "../lib/requestUrl.js";

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
    defaultMode: enumSchema(SETTINGS_MODE_OPTIONS),
    defaultTiming: enumSchema(SETTINGS_TIMING_OPTIONS),
    defaultPaymentsPerYear: Type.Integer({ minimum: 1, maximum: 365 }),
    defaultHistoryPageSize: Type.Integer({ minimum: 1, maximum: 100 }),
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
    defaultMode: Type.Optional(enumSchema(SETTINGS_MODE_OPTIONS)),
    defaultTiming: Type.Optional(enumSchema(SETTINGS_TIMING_OPTIONS)),
    defaultPaymentsPerYear: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
    defaultHistoryPageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
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

function buildDefaultRoutes(controllers) {
  return [
    {
      path: "/api/register",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Register a new user",
        body: registerCredentialsSchema,
        response: withStandardErrorResponses(
          {
            201: registerResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.register
    },
    {
      path: "/api/login",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Log in with Supabase credentials",
        body: loginCredentialsSchema,
        response: withStandardErrorResponses(
          {
            200: loginResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.login
    },
    {
      path: "/api/login/otp/request",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Request one-time email login code",
        body: emailOnlySchema,
        response: withStandardErrorResponses(
          {
            200: okMessageResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.requestOtpLogin
    },
    {
      path: "/api/login/otp/verify",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Verify one-time email login code and create session",
        body: otpLoginVerifyBodySchema,
        response: withStandardErrorResponses(
          {
            200: otpLoginVerifyResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.verifyOtpLogin
    },
    {
      path: "/api/oauth/:provider/start",
      method: "GET",
      auth: "public",
      csrfProtection: false,
      schema: {
        tags: ["auth"],
        summary: "Start OAuth login with Supabase provider",
        params: oauthStartParamsSchema,
        querystring: oauthStartQuerySchema,
        response: withStandardErrorResponses(
          {
            302: Type.Unknown()
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.oauthStart
    },
    {
      path: "/api/oauth/complete",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Complete OAuth code exchange and set session cookies",
        body: oauthCompleteBodySchema,
        response: withStandardErrorResponses(
          {
            200: oauthCompleteResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.oauthComplete
    },
    {
      path: "/api/password/forgot",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Request a password reset email",
        body: emailOnlySchema,
        response: withStandardErrorResponses(
          {
            200: okMessageResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 5,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.requestPasswordReset
    },
    {
      path: "/api/password/recovery",
      method: "POST",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Complete password recovery link exchange",
        body: passwordRecoverySchema,
        response: withStandardErrorResponses(
          {
            200: okResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.completePasswordRecovery
    },
    {
      path: "/api/password/reset",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["auth"],
        summary: "Set a new password for authenticated recovery session",
        body: passwordOnlySchema,
        response: withStandardErrorResponses(
          {
            200: okMessageResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.auth.resetPassword
    },
    {
      path: "/api/logout",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["auth"],
        summary: "Log out and clear session cookies",
        response: withStandardErrorResponses({
          200: logoutResponseSchema
        })
      },
      handler: controllers.auth.logout
    },
    {
      path: "/api/session",
      method: "GET",
      auth: "public",
      schema: {
        tags: ["auth"],
        summary: "Get current session status and CSRF token",
        response: withStandardErrorResponses({
          200: sessionResponseSchema,
          503: sessionErrorResponseSchema
        })
      },
      handler: controllers.auth.session
    },
    {
      path: "/api/settings",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Get authenticated user's settings",
        response: withStandardErrorResponses({
          200: settingsResponseSchema
        })
      },
      handler: controllers.settings.get
    },
    {
      path: "/api/settings/profile",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Update profile settings",
        body: settingsProfileUpdateBodySchema,
        response: withStandardErrorResponses(
          {
            200: settingsResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.settings.updateProfile
    },
    {
      path: "/api/settings/profile/avatar",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Upload profile avatar",
        description: `Multipart upload. Allowed mime types: ${AVATAR_ALLOWED_MIME_TYPES.join(
          ", "
        )}. Max bytes: ${AVATAR_MAX_UPLOAD_BYTES}. Optional uploadDimension: ${AVATAR_UPLOAD_DIMENSION_OPTIONS.join(
          ", "
        )} (default ${AVATAR_DEFAULT_UPLOAD_DIMENSION}).`,
        consumes: ["multipart/form-data"],
        response: withStandardErrorResponses(
          {
            200: settingsResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.settings.uploadAvatar
    },
    {
      path: "/api/settings/profile/avatar",
      method: "DELETE",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Delete profile avatar and fallback to gravatar",
        response: withStandardErrorResponses({
          200: settingsResponseSchema
        })
      },
      handler: controllers.settings.deleteAvatar
    },
    {
      path: "/api/settings/preferences",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Update user preferences",
        body: settingsPreferencesUpdateBodySchema,
        response: withStandardErrorResponses(
          {
            200: settingsResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.settings.updatePreferences
    },
    {
      path: "/api/settings/notifications",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Update notification settings",
        body: settingsNotificationsUpdateBodySchema,
        response: withStandardErrorResponses(
          {
            200: settingsResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.settings.updateNotifications
    },
    {
      path: "/api/settings/security/change-password",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Set or change authenticated user's password",
        body: changePasswordBodySchema,
        response: withStandardErrorResponses(
          {
            200: okMessageResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      },
      handler: controllers.settings.changePassword
    },
    {
      path: "/api/settings/security/methods/password",
      method: "PATCH",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Enable or disable password sign-in method",
        body: passwordMethodToggleBodySchema,
        response: withStandardErrorResponses(
          {
            200: settingsResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.settings.setPasswordMethodEnabled
    },
    {
      path: "/api/settings/security/oauth/:provider/start",
      method: "GET",
      auth: "required",
      csrfProtection: false,
      schema: {
        tags: ["settings"],
        summary: "Start linking an OAuth provider for authenticated user",
        params: oauthStartParamsSchema,
        querystring: oauthStartQuerySchema,
        response: withStandardErrorResponses(
          {
            302: Type.Unknown()
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.settings.startOAuthProviderLink
    },
    {
      path: "/api/settings/security/oauth/:provider",
      method: "DELETE",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Unlink an OAuth provider from authenticated account",
        params: oauthStartParamsSchema,
        response: withStandardErrorResponses(
          {
            200: settingsResponseSchema
          },
          { includeValidation400: true }
        )
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.settings.unlinkOAuthProvider
    },
    {
      path: "/api/settings/security/logout-others",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["settings"],
        summary: "Sign out from other active sessions",
        response: withStandardErrorResponses({
          200: okMessageResponseSchema
        })
      },
      rateLimit: {
        max: 20,
        timeWindow: "1 minute"
      },
      handler: controllers.settings.logoutOtherSessions
    },
    {
      path: "/api/history",
      method: "GET",
      auth: "required",
      schema: {
        tags: ["history"],
        summary: "List authenticated user's calculation history",
        querystring: historyQuerySchema,
        response: withStandardErrorResponses(
          {
            200: historyListResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.history.list
    },
    {
      path: "/api/annuityCalculator",
      method: "POST",
      auth: "required",
      schema: {
        tags: ["annuityCalculator"],
        summary: "Calculate annuity value and append history",
        body: annuityCalculatorRequestBodySchema,
        response: withStandardErrorResponses(
          {
            200: annuityCalculatorResponseSchema
          },
          { includeValidation400: true }
        )
      },
      handler: controllers.annuity.calculate
    }
  ];
}

function registerApiRoutes(fastify, { controllers, routes }) {
  const routeList = Array.isArray(routes) && routes.length > 0 ? routes : buildDefaultRoutes(controllers);

  for (const route of routeList) {
    fastify.route({
      method: route.method,
      url: route.path,
      ...(route.schema ? { schema: route.schema } : {}),
      config: {
        authPolicy: route.auth || "public",
        ownerParam: route.ownerParam || null,
        userField: route.userField || "id",
        ownerResolver: typeof route.ownerResolver === "function" ? route.ownerResolver : null,
        csrfProtection: route.csrfProtection !== false,
        ...(route.rateLimit ? { rateLimit: route.rateLimit } : {})
      },
      handler: async (request, reply) => {
        await route.handler(request, reply, safeRequestUrl(request));
      }
    });
  }
}

export { buildDefaultRoutes, registerApiRoutes };
