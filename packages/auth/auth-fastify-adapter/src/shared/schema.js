import { Type } from "@fastify/type-provider-typebox";
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
} from "@jskit-ai/access-core/authConstraints";
import { AUTH_METHOD_IDS, AUTH_METHOD_KINDS } from "@jskit-ai/access-core/authMethods";
import { OAUTH_PROVIDER_ID_PATTERN } from "@jskit-ai/access-core/oauthProviders";
import { enumSchema } from "@jskit-ai/http-contracts/errorResponses";

const registerCredentials = Type.Object(
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

const loginCredentials = Type.Object(
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

const otpVerifyBody = Type.Object(
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

const oauthProvider = Type.String({
  minLength: 2,
  maxLength: 32,
  pattern: OAUTH_PROVIDER_ID_PATTERN
});
const authMethodId = Type.String({
  minLength: 3,
  maxLength: 38,
  pattern: `^(?:${AUTH_METHOD_IDS.join("|")}|oauth:${OAUTH_PROVIDER_ID_PATTERN.slice(1, -1)})$`
});
const authMethodKind = enumSchema(AUTH_METHOD_KINDS);
const oauthReturnTo = Type.String({
  minLength: 1,
  maxLength: 1024,
  pattern: "^/(?!/).*$"
});

const oauthStartParams = Type.Object(
  {
    provider: oauthProvider
  },
  {
    additionalProperties: false
  }
);

const oauthStartQuery = Type.Object(
  {
    returnTo: Type.Optional(oauthReturnTo)
  },
  {
    additionalProperties: false
  }
);

const oauthCompleteBody = Type.Object(
  {
    provider: oauthProvider,
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

const emailOnly = Type.Object(
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

const otpRequestBody = Type.Object(
  {
    email: Type.String({
      minLength: AUTH_EMAIL_MIN_LENGTH,
      maxLength: AUTH_EMAIL_MAX_LENGTH,
      pattern: AUTH_EMAIL_PATTERN
    }),
    returnTo: Type.Optional(oauthReturnTo)
  },
  {
    additionalProperties: false
  }
);

const passwordOnly = Type.Object(
  {
    password: Type.String({ minLength: AUTH_PASSWORD_MIN_LENGTH, maxLength: AUTH_PASSWORD_MAX_LENGTH })
  },
  {
    additionalProperties: false
  }
);

const passwordMethodToggleBody = Type.Object(
  {
    enabled: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const passwordRecovery = Type.Object(
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

const okResponse = Type.Object(
  {
    ok: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const okMessageResponse = Type.Object(
  {
    ok: Type.Boolean(),
    message: Type.String({ minLength: 1 })
  },
  {
    additionalProperties: false
  }
);

const registerResponse = Type.Object(
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

const loginResponse = Type.Object(
  {
    ok: Type.Boolean(),
    username: Type.String({ minLength: 1, maxLength: 120 })
  },
  {
    additionalProperties: false
  }
);

const otpVerifyResponse = Type.Object(
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

const oauthCompleteResponse = Type.Object(
  {
    ok: Type.Boolean(),
    provider: oauthProvider,
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

const logoutResponse = Type.Object(
  {
    ok: Type.Boolean()
  },
  {
    additionalProperties: false
  }
);

const oauthProviderCatalogEntry = Type.Object(
  {
    id: oauthProvider,
    label: Type.String({ minLength: 1, maxLength: 120 })
  },
  {
    additionalProperties: false
  }
);

const sessionResponse = Type.Object(
  {
    authenticated: Type.Boolean(),
    username: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    csrfToken: Type.String({ minLength: 1 }),
    oauthProviders: Type.Array(oauthProviderCatalogEntry),
    oauthDefaultProvider: Type.Union([oauthProvider, Type.Null()])
  },
  {
    additionalProperties: false
  }
);

const sessionErrorResponse = Type.Object(
  {
    error: Type.String({ minLength: 1 }),
    csrfToken: Type.String({ minLength: 1 }),
    oauthProviders: Type.Array(oauthProviderCatalogEntry),
    oauthDefaultProvider: Type.Union([oauthProvider, Type.Null()])
  },
  {
    additionalProperties: false
  }
);

const schema = {
  fields: {
    oauthProvider,
    authMethodId,
    authMethodKind,
    oauthReturnTo
  },
  register: {
    body: registerCredentials,
    response: registerResponse
  },
  login: {
    body: loginCredentials,
    response: loginResponse
  },
  otpRequest: {
    body: otpRequestBody,
    response: okMessageResponse
  },
  otpVerify: {
    body: otpVerifyBody,
    response: otpVerifyResponse
  },
  oauthStart: {
    params: oauthStartParams,
    query: oauthStartQuery
  },
  oauthComplete: {
    body: oauthCompleteBody,
    response: oauthCompleteResponse
  },
  passwordForgot: {
    body: emailOnly,
    response: okMessageResponse
  },
  passwordRecovery: {
    body: passwordRecovery,
    response: okResponse
  },
  passwordReset: {
    body: passwordOnly,
    response: okMessageResponse
  },
  passwordMethodToggle: {
    body: passwordMethodToggleBody,
    response: okMessageResponse
  },
  logout: {
    response: logoutResponse
  },
  session: {
    response: sessionResponse,
    unavailable: sessionErrorResponse
  }
};

export { schema };
