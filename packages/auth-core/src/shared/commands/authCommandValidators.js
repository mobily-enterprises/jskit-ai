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
} from "../authConstraints.js";
import { AUTH_METHOD_IDS, AUTH_METHOD_KINDS } from "../authMethods.js";
import { OAUTH_PROVIDER_ID_PATTERN } from "../oauthProviders.js";

const oauthProviderValidator = Object.freeze({
  schema: Type.String({
    minLength: 2,
    maxLength: 32,
    pattern: OAUTH_PROVIDER_ID_PATTERN
  })
});

const authMethodIdValidator = Object.freeze({
  schema: Type.String({
    minLength: 3,
    maxLength: 38,
    pattern: `^(?:${AUTH_METHOD_IDS.join("|")}|oauth:${OAUTH_PROVIDER_ID_PATTERN.slice(1, -1)})$`
  })
});

const authMethodKindValidator = Object.freeze({
  schema: Type.Union(AUTH_METHOD_KINDS.map((kind) => Type.Literal(kind)))
});

const OAUTH_RETURN_TO_PATTERN = "^(?:/(?!/).*$|https?://[^\\s]+)$";

const oauthReturnToValidator = Object.freeze({
  schema: Type.String({
    minLength: 1,
    maxLength: 1024,
    pattern: OAUTH_RETURN_TO_PATTERN
  })
});

const authEmailValidator = Object.freeze({
  schema: Type.String({
    minLength: AUTH_EMAIL_MIN_LENGTH,
    maxLength: AUTH_EMAIL_MAX_LENGTH,
    pattern: AUTH_EMAIL_PATTERN
  })
});

const authPasswordValidator = Object.freeze({
  schema: Type.String({
    minLength: AUTH_PASSWORD_MIN_LENGTH,
    maxLength: AUTH_PASSWORD_MAX_LENGTH
  })
});

const authLoginPasswordValidator = Object.freeze({
  schema: Type.String({
    minLength: 1,
    maxLength: AUTH_LOGIN_PASSWORD_MAX_LENGTH
  })
});

const authRecoveryTokenValidator = Object.freeze({
  schema: Type.String({
    minLength: 1,
    maxLength: AUTH_RECOVERY_TOKEN_MAX_LENGTH
  })
});

const authAccessTokenValidator = Object.freeze({
  schema: Type.String({
    minLength: 1,
    maxLength: AUTH_ACCESS_TOKEN_MAX_LENGTH
  })
});

const authRefreshTokenValidator = Object.freeze({
  schema: Type.String({
    minLength: 1,
    maxLength: AUTH_REFRESH_TOKEN_MAX_LENGTH
  })
});

const okResponseValidator = Object.freeze({
  schema: Type.Object(
    {
      ok: Type.Boolean()
    },
    {
      additionalProperties: false
    }
  )
});

const okMessageResponseValidator = Object.freeze({
  schema: Type.Object(
    {
      ok: Type.Boolean(),
      message: Type.String({ minLength: 1 })
    },
    {
      additionalProperties: false
    }
  )
});

const registerResponseValidator = Object.freeze({
  schema: Type.Object(
    {
      ok: Type.Boolean(),
      requiresEmailConfirmation: Type.Boolean(),
      username: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      message: Type.Optional(Type.String({ minLength: 1 }))
    },
    {
      additionalProperties: false
    }
  )
});

const loginResponseValidator = Object.freeze({
  schema: Type.Object(
    {
      ok: Type.Boolean(),
      username: Type.String({ minLength: 1, maxLength: 120 })
    },
    {
      additionalProperties: false
    }
  )
});

const otpVerifyResponseValidator = Object.freeze({
  schema: Type.Object(
    {
      ok: Type.Boolean(),
      username: Type.String({ minLength: 1, maxLength: 120 }),
      email: authEmailValidator.schema
    },
    {
      additionalProperties: false
    }
  )
});

const oauthCompleteResponseValidator = Object.freeze({
  schema: Type.Object(
    {
      ok: Type.Boolean(),
      provider: Type.Optional(oauthProviderValidator.schema),
      username: Type.String({ minLength: 1, maxLength: 120 }),
      email: authEmailValidator.schema
    },
    {
      additionalProperties: false
    }
  )
});

const devLoginAsResponseValidator = Object.freeze({
  schema: Type.Object(
    {
      ok: Type.Boolean(),
      userId: Type.String({ minLength: 1 }),
      username: Type.String({ minLength: 1, maxLength: 120 }),
      email: authEmailValidator.schema
    },
    {
      additionalProperties: false
    }
  )
});

const logoutResponseValidator = Object.freeze({
  schema: Type.Object(
    {
      ok: Type.Boolean()
    },
    {
      additionalProperties: false
    }
  )
});

const oauthProviderCatalogEntryValidator = Object.freeze({
  schema: Type.Object(
    {
      id: oauthProviderValidator.schema,
      label: Type.String({ minLength: 1, maxLength: 120 })
    },
    {
      additionalProperties: false
    }
  )
});

const sessionResponseValidator = Object.freeze({
  schema: Type.Object(
    {
      authenticated: Type.Boolean(),
      username: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      email: Type.Optional(authEmailValidator.schema),
      permissions: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }))),
      csrfToken: Type.String({ minLength: 1 }),
      oauthProviders: Type.Array(oauthProviderCatalogEntryValidator.schema),
      oauthDefaultProvider: Type.Union([oauthProviderValidator.schema, Type.Null()])
    },
    {
      additionalProperties: false
    }
  )
});

const sessionUnavailableResponseValidator = Object.freeze({
  schema: Type.Object(
    {
      error: Type.String({ minLength: 1 }),
      csrfToken: Type.String({ minLength: 1 }),
      oauthProviders: Type.Array(oauthProviderCatalogEntryValidator.schema),
      oauthDefaultProvider: Type.Union([oauthProviderValidator.schema, Type.Null()])
    },
    {
      additionalProperties: false
    }
  )
});

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
  authEmailValidator,
  authPasswordValidator,
  authLoginPasswordValidator,
  authRecoveryTokenValidator,
  authAccessTokenValidator,
  authRefreshTokenValidator,
  oauthProviderValidator,
  authMethodIdValidator,
  authMethodKindValidator,
  oauthReturnToValidator,
  okResponseValidator,
  okMessageResponseValidator,
  registerResponseValidator,
  loginResponseValidator,
  otpVerifyResponseValidator,
  oauthCompleteResponseValidator,
  devLoginAsResponseValidator,
  logoutResponseValidator,
  oauthProviderCatalogEntryValidator,
  sessionResponseValidator,
  sessionUnavailableResponseValidator,
  createCommandMessages
};
