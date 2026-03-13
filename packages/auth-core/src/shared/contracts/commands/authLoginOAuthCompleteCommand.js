import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";
import {
  authAccessTokenSchema,
  authRecoveryTokenSchema,
  authRefreshTokenSchema,
  createCommandMessages,
  oauthCompleteResponseSchema,
  oauthProviderSchema
} from "./authCommandSchemas.js";

const authLoginOAuthCompleteInputSchema = Type.Object(
  {
    provider: oauthProviderSchema,
    code: Type.Optional(authRecoveryTokenSchema),
    accessToken: Type.Optional(authAccessTokenSchema),
    refreshToken: Type.Optional(authRefreshTokenSchema),
    error: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    errorDescription: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
    error_code: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    error_description: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 }))
  },
  {
    additionalProperties: false
  }
);

const authLoginOAuthCompleteOutputSchema = oauthCompleteResponseSchema;

const AUTH_LOGIN_OAUTH_COMPLETE_MESSAGES = createCommandMessages({
  fields: {
    provider: {
      required: "OAuth provider is required.",
      pattern: "OAuth provider id is invalid.",
      default: "OAuth provider id is invalid."
    },
    code: {
      default: "OAuth code is invalid."
    },
    accessToken: {
      default: "Access token is invalid."
    },
    refreshToken: {
      default: "Refresh token is invalid."
    }
  }
});

const authLoginOAuthCompleteCommand = Object.freeze({
  command: "auth.login.oauth.complete",
  operation: Object.freeze({
    method: "POST",
    body: Object.freeze({
      schema: authLoginOAuthCompleteInputSchema,
      normalize: normalizeObjectInput,
      messages: AUTH_LOGIN_OAUTH_COMPLETE_MESSAGES
    }),
    response: Object.freeze({
      schema: authLoginOAuthCompleteOutputSchema
    }),
    messages: AUTH_LOGIN_OAUTH_COMPLETE_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export {
  authLoginOAuthCompleteInputSchema,
  authLoginOAuthCompleteOutputSchema,
  AUTH_LOGIN_OAUTH_COMPLETE_MESSAGES,
  authLoginOAuthCompleteCommand
};
