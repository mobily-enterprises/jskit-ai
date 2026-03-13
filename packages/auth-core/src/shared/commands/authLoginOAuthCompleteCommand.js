import { Type } from "typebox";
import { normalizeObjectInput } from "../inputNormalization.js";
import {
  authAccessTokenValidator,
  authRecoveryTokenValidator,
  authRefreshTokenValidator,
  createCommandMessages,
  oauthCompleteResponseValidator,
  oauthProviderValidator
} from "./authCommandValidators.js";

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

const authLoginOAuthCompleteBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      provider: oauthProviderValidator.schema,
      code: Type.Optional(authRecoveryTokenValidator.schema),
      accessToken: Type.Optional(authAccessTokenValidator.schema),
      refreshToken: Type.Optional(authRefreshTokenValidator.schema),
      error: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      errorDescription: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
      error_code: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      error_description: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 }))
    },
    {
      additionalProperties: false
    }
  ),
  normalize: normalizeObjectInput,
  messages: AUTH_LOGIN_OAUTH_COMPLETE_MESSAGES
});

const authLoginOAuthCompleteCommand = Object.freeze({
  command: "auth.login.oauth.complete",
  operation: Object.freeze({
    method: "POST",
    bodyValidator: authLoginOAuthCompleteBodyValidator,
    responseValidator: oauthCompleteResponseValidator,
    messages: AUTH_LOGIN_OAUTH_COMPLETE_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export {
  authLoginOAuthCompleteBodyValidator,
  oauthCompleteResponseValidator,
  AUTH_LOGIN_OAUTH_COMPLETE_MESSAGES,
  authLoginOAuthCompleteCommand
};
