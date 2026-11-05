import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authAccessTokenFieldDefinition,
  authRecoveryTokenFieldDefinition,
  authRefreshTokenFieldDefinition,
  AUTH_FIELD_MESSAGES,
  createCommandMessages,
  oauthCompleteOutputValidator,
  oauthProviderFieldDefinition
} from "./authCommandValidators.js";

const AUTH_LOGIN_OAUTH_COMPLETE_MESSAGES = createCommandMessages({
  fields: {
    provider: {
      pattern: AUTH_FIELD_MESSAGES.oauthProviderInvalid,
      default: AUTH_FIELD_MESSAGES.oauthProviderInvalid
    },
    code: {
      default: AUTH_FIELD_MESSAGES.oauthCodeInvalid
    },
    accessToken: {
      default: AUTH_FIELD_MESSAGES.accessTokenInvalid
    },
    refreshToken: {
      default: AUTH_FIELD_MESSAGES.refreshTokenInvalid
    },
    state: {
      default: AUTH_FIELD_MESSAGES.oauthStateInvalid
    },
    iss: {
      default: AUTH_FIELD_MESSAGES.oauthIssuerInvalid
    }
  }
});

const authLoginOAuthCompleteBodyValidator = deepFreeze({
  schema: createSchema({
    provider: { ...oauthProviderFieldDefinition, required: false },
    code: { ...authRecoveryTokenFieldDefinition, required: false },
    accessToken: { ...authAccessTokenFieldDefinition, required: false },
    refreshToken: { ...authRefreshTokenFieldDefinition, required: false },
    state: { type: "string", required: false, minLength: 1, maxLength: 512 },
    iss: { type: "string", required: false, minLength: 1, maxLength: 2048 },
    error: { type: "string", required: false, minLength: 1, maxLength: 128 },
    errorDescription: { type: "string", required: false, minLength: 1, maxLength: 1024 },
    error_code: { type: "string", required: false, minLength: 1, maxLength: 128 },
    error_description: { type: "string", required: false, minLength: 1, maxLength: 1024 }
  }),
  mode: "create",
  messages: AUTH_LOGIN_OAUTH_COMPLETE_MESSAGES
});

const authLoginOAuthCompleteCommand = deepFreeze({
  command: "auth.login.oauth.complete",
  operation: {
    method: "POST",
    body: authLoginOAuthCompleteBodyValidator,
    response: oauthCompleteOutputValidator,
    messages: AUTH_LOGIN_OAUTH_COMPLETE_MESSAGES,
    idempotent: false,
    invalidates: ["auth.session.read"]
  }
});

export {
  authLoginOAuthCompleteBodyValidator,
  oauthCompleteOutputValidator,
  AUTH_LOGIN_OAUTH_COMPLETE_MESSAGES,
  authLoginOAuthCompleteCommand
};
