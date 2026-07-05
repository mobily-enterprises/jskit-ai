import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  AUTH_DENIED_CODE_MAX_LENGTH,
  AUTH_DENIED_CODE_PATTERN,
  AUTH_DENIED_MESSAGE_MAX_LENGTH
} from "../authDenied.js";
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
import { AUTH_PASSWORD_RECOVERY_DELIVERIES } from "../authCapabilities.js";
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

const okOutputValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true }
  }),
  mode: "replace"
});

const okMessageOutputValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    message: { type: "string", required: true, minLength: 1 }
  }),
  mode: "replace"
});

const registerOutputValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    requiresEmailConfirmation: { type: "boolean", required: true },
    username: { type: "string", required: false, minLength: 1, maxLength: 120 },
    message: { type: "string", required: false, minLength: 1 }
  }),
  mode: "replace"
});

const loginOutputValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    username: { type: "string", required: true, minLength: 1, maxLength: 120 }
  }),
  mode: "replace"
});

const otpVerifyOutputValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    username: { type: "string", required: true, minLength: 1, maxLength: 120 },
    email: { ...authEmailFieldDefinition, required: true }
  }),
  mode: "replace"
});

const oauthCompleteOutputValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    provider: { ...oauthProviderFieldDefinition, required: false },
    username: { type: "string", required: true, minLength: 1, maxLength: 120 },
    email: { ...authEmailFieldDefinition, required: true }
  }),
  mode: "replace"
});

const devLoginAsOutputValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    userId: { type: "string", required: true, minLength: 1 },
    username: { type: "string", required: true, minLength: 1, maxLength: 120 },
    email: { ...authEmailFieldDefinition, required: true }
  }),
  mode: "replace"
});

const logoutOutputValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true }
  }),
  mode: "replace"
});

const oauthProviderCatalogEntrySchema = createSchema({
  id: { ...oauthProviderFieldDefinition, required: true },
  label: { type: "string", required: true, minLength: 1, maxLength: 120 }
});

const oauthProviderCatalogEntryOutputValidator = deepFreeze({
  schema: oauthProviderCatalogEntrySchema,
  mode: "replace"
});

const authDeniedOutputSchema = createSchema({
  code: {
    type: "string",
    required: true,
    minLength: 2,
    maxLength: AUTH_DENIED_CODE_MAX_LENGTH,
    pattern: AUTH_DENIED_CODE_PATTERN
  },
  message: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: AUTH_DENIED_MESSAGE_MAX_LENGTH
  }
});

const authCapabilityProviderOutputSchema = createSchema({
  id: {
    type: "string",
    required: true,
    minLength: 2,
    maxLength: 64,
    pattern: "^[a-z][a-z0-9_-]{1,63}$"
  },
  label: {
    type: "string",
    required: true,
    minLength: 1,
    maxLength: 120
  }
});

const authPasswordCapabilitiesOutputSchema = createSchema({
  login: { type: "boolean", required: true },
  register: { type: "boolean", required: true },
  change: { type: "boolean", required: true },
  methodToggle: { type: "boolean", required: true }
});

const authPasswordRecoveryCapabilitiesOutputSchema = createSchema({
  request: { type: "boolean", required: true },
  complete: { type: "boolean", required: true },
  delivery: {
    type: "string",
    required: true,
    enum: AUTH_PASSWORD_RECOVERY_DELIVERIES
  }
});

const authOtpCapabilitiesOutputSchema = createSchema({
  login: { type: "boolean", required: true }
});

const authOAuthLoginCapabilitiesOutputSchema = createSchema({
  enabled: { type: "boolean", required: true },
  providers: {
    type: "array",
    required: true,
    items: oauthProviderCatalogEntrySchema
  },
  defaultProvider: {
    ...oauthProviderFieldDefinition,
    required: true,
    nullable: true
  }
});

const authProviderLinkingCapabilitiesOutputSchema = createSchema({
  start: { type: "boolean", required: true },
  unlink: { type: "boolean", required: true }
});

const authCapabilitiesFeaturesOutputSchema = createSchema({
  password: {
    type: "object",
    required: true,
    schema: authPasswordCapabilitiesOutputSchema
  },
  passwordRecovery: {
    type: "object",
    required: true,
    schema: authPasswordRecoveryCapabilitiesOutputSchema
  },
  otp: {
    type: "object",
    required: true,
    schema: authOtpCapabilitiesOutputSchema
  },
  oauthLogin: {
    type: "object",
    required: true,
    schema: authOAuthLoginCapabilitiesOutputSchema
  },
  emailConfirmation: { type: "boolean", required: true },
  profileUpdate: { type: "boolean", required: true },
  providerLinking: {
    type: "object",
    required: true,
    schema: authProviderLinkingCapabilitiesOutputSchema
  },
  securityStatus: { type: "boolean", required: true },
  signOutOtherSessions: { type: "boolean", required: true },
  appProfileProjection: { type: "boolean", required: true },
  devLoginAs: { type: "boolean", required: true }
});

const authCapabilitiesOutputSchema = createSchema({
  provider: {
    type: "object",
    required: true,
    schema: authCapabilityProviderOutputSchema
  },
  features: {
    type: "object",
    required: true,
    schema: authCapabilitiesFeaturesOutputSchema
  }
});

const sessionOutputSchema = createSchema({
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
  authDenied: {
    type: "object",
    required: false,
    schema: authDeniedOutputSchema
  },
  authCapabilities: {
    type: "object",
    required: true,
    schema: authCapabilitiesOutputSchema
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

const sessionOutputValidator = deepFreeze({
  schema: sessionOutputSchema,
  mode: "replace"
});

const sessionUnavailableOutputSchema = createSchema({
  error: { type: "string", required: true, minLength: 1 },
  csrfToken: { type: "string", required: true, minLength: 1 },
  authCapabilities: {
    type: "object",
    required: true,
    schema: authCapabilitiesOutputSchema
  },
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

const sessionUnavailableOutputValidator = deepFreeze({
  schema: sessionUnavailableOutputSchema,
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
  okOutputValidator,
  okMessageOutputValidator,
  registerOutputValidator,
  loginOutputValidator,
  otpVerifyOutputValidator,
  oauthCompleteOutputValidator,
  devLoginAsOutputValidator,
  logoutOutputValidator,
  oauthProviderCatalogEntryOutputValidator,
  authDeniedOutputSchema,
  authCapabilitiesOutputSchema,
  sessionOutputValidator,
  sessionUnavailableOutputValidator,
  createCommandMessages
};
