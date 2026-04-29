import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
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

const oauthProviderFieldDefinition = deepFreeze({
  type: "string",
  minLength: 2,
  maxLength: 32,
  pattern: OAUTH_PROVIDER_ID_PATTERN
});

const authMethodIdFieldDefinition = deepFreeze({
  type: "string",
  minLength: 3,
  maxLength: 38,
  pattern: `^(?:${AUTH_METHOD_IDS.join("|")}|oauth:${OAUTH_PROVIDER_ID_PATTERN.slice(1, -1)})$`
});

const authMethodKindFieldDefinition = deepFreeze({
  type: "string",
  enum: AUTH_METHOD_KINDS
});

const OAUTH_RETURN_TO_PATTERN = "^(?:/(?!/).*$|https?://[^\\s]+)$";

const oauthReturnToFieldDefinition = deepFreeze({
  type: "string",
  minLength: 1,
  maxLength: 1024,
  pattern: OAUTH_RETURN_TO_PATTERN
});

const authEmailFieldDefinition = deepFreeze({
  type: "string",
  lowercase: true,
  minLength: AUTH_EMAIL_MIN_LENGTH,
  maxLength: AUTH_EMAIL_MAX_LENGTH,
  pattern: AUTH_EMAIL_PATTERN
});

const authPasswordFieldDefinition = deepFreeze({
  type: "string",
  minLength: AUTH_PASSWORD_MIN_LENGTH,
  maxLength: AUTH_PASSWORD_MAX_LENGTH
});

const authLoginPasswordFieldDefinition = deepFreeze({
  type: "string",
  minLength: 1,
  maxLength: AUTH_LOGIN_PASSWORD_MAX_LENGTH
});

const authRecoveryTokenFieldDefinition = deepFreeze({
  type: "string",
  minLength: 1,
  maxLength: AUTH_RECOVERY_TOKEN_MAX_LENGTH
});

const authAccessTokenFieldDefinition = deepFreeze({
  type: "string",
  minLength: 1,
  maxLength: AUTH_ACCESS_TOKEN_MAX_LENGTH
});

const authRefreshTokenFieldDefinition = deepFreeze({
  type: "string",
  minLength: 1,
  maxLength: AUTH_REFRESH_TOKEN_MAX_LENGTH
});

const oauthProviderValidator = deepFreeze({
  type: "string",
  ...oauthProviderFieldDefinition
});

const authMethodIdValidator = deepFreeze({
  type: "string",
  ...authMethodIdFieldDefinition
});

const authMethodKindValidator = deepFreeze({
  type: "string",
  enum: AUTH_METHOD_KINDS
});

const oauthReturnToValidator = deepFreeze({
  type: "string",
  ...oauthReturnToFieldDefinition
});

const authEmailValidator = deepFreeze({
  type: "string",
  ...authEmailFieldDefinition
});

const authPasswordValidator = deepFreeze({
  type: "string",
  ...authPasswordFieldDefinition
});

const authLoginPasswordValidator = deepFreeze({
  type: "string",
  ...authLoginPasswordFieldDefinition
});

const authRecoveryTokenValidator = deepFreeze({
  type: "string",
  ...authRecoveryTokenFieldDefinition
});

const authAccessTokenValidator = deepFreeze({
  type: "string",
  ...authAccessTokenFieldDefinition
});

const authRefreshTokenValidator = deepFreeze({
  type: "string",
  ...authRefreshTokenFieldDefinition
});

const okResponseValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true }
  }),
  mode: "replace"
});

const okMessageResponseValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    message: { type: "string", required: true, minLength: 1 }
  }),
  mode: "replace"
});

const registerResponseValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    requiresEmailConfirmation: { type: "boolean", required: true },
    username: { type: "string", required: false, minLength: 1, maxLength: 120 },
    message: { type: "string", required: false, minLength: 1 }
  }),
  mode: "replace"
});

const loginResponseValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    username: { type: "string", required: true, minLength: 1, maxLength: 120 }
  }),
  mode: "replace"
});

const otpVerifyResponseValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    username: { type: "string", required: true, minLength: 1, maxLength: 120 },
    email: { ...authEmailFieldDefinition, required: true }
  }),
  mode: "replace"
});

const oauthCompleteResponseValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    provider: { ...oauthProviderFieldDefinition, required: false },
    username: { type: "string", required: true, minLength: 1, maxLength: 120 },
    email: { ...authEmailFieldDefinition, required: true }
  }),
  mode: "replace"
});

const devLoginAsResponseValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    userId: { type: "string", required: true, minLength: 1 },
    username: { type: "string", required: true, minLength: 1, maxLength: 120 },
    email: { ...authEmailFieldDefinition, required: true }
  }),
  mode: "replace"
});

const logoutResponseValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true }
  }),
  mode: "replace"
});

const oauthProviderCatalogEntrySchema = createSchema({
  id: { ...oauthProviderFieldDefinition, required: true },
  label: { type: "string", required: true, minLength: 1, maxLength: 120 }
});

const oauthProviderCatalogEntryValidator = deepFreeze({
  schema: oauthProviderCatalogEntrySchema,
  mode: "replace"
});

const sessionResponseSchema = createSchema({
  authenticated: { type: "boolean", required: true },
  username: { type: "string", required: false, minLength: 1, maxLength: 120 },
  email: { ...authEmailFieldDefinition, required: false },
  permissions: {
    type: "array",
    required: false,
    items: {
      type: "string",
      minLength: 1,
      maxLength: 200
    }
  },
  csrfToken: { type: "string", required: true, minLength: 1 },
  oauthProviders: {
    type: "array",
    required: true,
    items: oauthProviderCatalogEntrySchema
  },
  oauthDefaultProvider: {
    ...oauthProviderFieldDefinition,
    required: true,
    nullable: true
  }
});

const sessionResponseValidator = deepFreeze({
  schema: sessionResponseSchema,
  mode: "replace"
});

const sessionUnavailableResponseSchema = createSchema({
  error: { type: "string", required: true, minLength: 1 },
  csrfToken: { type: "string", required: true, minLength: 1 },
  oauthProviders: {
    type: "array",
    required: true,
    items: oauthProviderCatalogEntrySchema
  },
  oauthDefaultProvider: {
    ...oauthProviderFieldDefinition,
    required: true,
    nullable: true
  }
});

const sessionUnavailableResponseValidator = deepFreeze({
  schema: sessionUnavailableResponseSchema,
  mode: "replace"
});

function createCommandMessages({
  fields = {},
  defaultMessage = "Invalid value."
} = {}) {
  return deepFreeze({
    apiValidation: "Validation failed.",
    fields: {
      ...(fields && typeof fields === "object" ? fields : {})
    },
    keywords: {
      additionalProperties: "Unexpected field."
    },
    default: String(defaultMessage || "Invalid value.")
  });
}

export {
  authEmailFieldDefinition,
  authPasswordFieldDefinition,
  authLoginPasswordFieldDefinition,
  authRecoveryTokenFieldDefinition,
  authAccessTokenFieldDefinition,
  authRefreshTokenFieldDefinition,
  oauthProviderFieldDefinition,
  authMethodIdFieldDefinition,
  authMethodKindFieldDefinition,
  oauthReturnToFieldDefinition,
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
