import { Type } from "typebox";
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
} from "../../authConstraints.js";
import { AUTH_METHOD_IDS, AUTH_METHOD_KINDS } from "../../authMethods.js";
import { OAUTH_PROVIDER_ID_PATTERN } from "../../oauthProviders.js";

const oauthProviderSchema = Type.String({
  minLength: 2,
  maxLength: 32,
  pattern: OAUTH_PROVIDER_ID_PATTERN
});

const authMethodIdSchema = Type.String({
  minLength: 3,
  maxLength: 38,
  pattern: `^(?:${AUTH_METHOD_IDS.join("|")}|oauth:${OAUTH_PROVIDER_ID_PATTERN.slice(1, -1)})$`
});

const authMethodKindSchema = Type.Union(
  AUTH_METHOD_KINDS.map((kind) => Type.Literal(kind))
);

const oauthReturnToSchema = Type.String({
  minLength: 1,
  maxLength: 1024,
  pattern: "^/(?!/).*$"
});

const authEmailSchema = Type.String({
  minLength: AUTH_EMAIL_MIN_LENGTH,
  maxLength: AUTH_EMAIL_MAX_LENGTH,
  pattern: AUTH_EMAIL_PATTERN
});

const authPasswordSchema = Type.String({
  minLength: AUTH_PASSWORD_MIN_LENGTH,
  maxLength: AUTH_PASSWORD_MAX_LENGTH
});

const authLoginPasswordSchema = Type.String({
  minLength: 1,
  maxLength: AUTH_LOGIN_PASSWORD_MAX_LENGTH
});

const authRecoveryTokenSchema = Type.String({
  minLength: 1,
  maxLength: AUTH_RECOVERY_TOKEN_MAX_LENGTH
});

const authAccessTokenSchema = Type.String({
  minLength: 1,
  maxLength: AUTH_ACCESS_TOKEN_MAX_LENGTH
});

const authRefreshTokenSchema = Type.String({
  minLength: 1,
  maxLength: AUTH_REFRESH_TOKEN_MAX_LENGTH
});

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

const otpVerifyResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    username: Type.String({ minLength: 1, maxLength: 120 }),
    email: authEmailSchema
  },
  {
    additionalProperties: false
  }
);

const oauthCompleteResponseSchema = Type.Object(
  {
    ok: Type.Boolean(),
    provider: oauthProviderSchema,
    username: Type.String({ minLength: 1, maxLength: 120 }),
    email: authEmailSchema
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

const oauthProviderCatalogEntrySchema = Type.Object(
  {
    id: oauthProviderSchema,
    label: Type.String({ minLength: 1, maxLength: 120 })
  },
  {
    additionalProperties: false
  }
);

const sessionResponseSchema = Type.Object(
  {
    authenticated: Type.Boolean(),
    username: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    csrfToken: Type.String({ minLength: 1 }),
    oauthProviders: Type.Array(oauthProviderCatalogEntrySchema),
    oauthDefaultProvider: Type.Union([oauthProviderSchema, Type.Null()])
  },
  {
    additionalProperties: false
  }
);

const sessionUnavailableResponseSchema = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    csrfToken: Type.String({ minLength: 1 }),
    oauthProviders: Type.Array(oauthProviderCatalogEntrySchema),
    oauthDefaultProvider: Type.Union([oauthProviderSchema, Type.Null()])
  },
  {
    additionalProperties: false
  }
);

function createCommandMessages({
  fields = {},
  defaultMessage = "Invalid value."
} = {}) {
  return Object.freeze({
    apiValidation: "Validation failed.",
    fields: Object.freeze({
      ...(fields && typeof fields === "object" ? fields : {})
    }),
    keywords: Object.freeze({
      additionalProperties: "Unexpected field."
    }),
    default: String(defaultMessage || "Invalid value.")
  });
}

export {
  authEmailSchema,
  authPasswordSchema,
  authLoginPasswordSchema,
  authRecoveryTokenSchema,
  authAccessTokenSchema,
  authRefreshTokenSchema,
  oauthProviderSchema,
  authMethodIdSchema,
  authMethodKindSchema,
  oauthReturnToSchema,
  okResponseSchema,
  okMessageResponseSchema,
  registerResponseSchema,
  loginResponseSchema,
  otpVerifyResponseSchema,
  oauthCompleteResponseSchema,
  logoutResponseSchema,
  oauthProviderCatalogEntrySchema,
  sessionResponseSchema,
  sessionUnavailableResponseSchema,
  createCommandMessages
};
