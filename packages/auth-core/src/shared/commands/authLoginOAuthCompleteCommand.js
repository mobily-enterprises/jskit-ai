import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authAccessTokenFieldDefinition,
  authRecoveryTokenFieldDefinition,
  authRefreshTokenFieldDefinition,
  createCommandMessages,
  oauthCompleteOutputValidator,
  oauthProviderFieldDefinition
} from "./authCommandValidators.js";

const AUTH_LOGIN_OAUTH_COMPLETE_MESSAGES = createCommandMessages({
  fields: {
    provider: {
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

const authLoginOAuthCompleteBodyValidator = deepFreeze({
  schema: createSchema({
    provider: { ...oauthProviderFieldDefinition, required: false },
    code: { ...authRecoveryTokenFieldDefinition, required: false },
    accessToken: { ...authAccessTokenFieldDefinition, required: false },
    refreshToken: { ...authRefreshTokenFieldDefinition, required: false },
    error: { type: "string", required: false, minLength: 1, maxLength: 128 },
    errorDescription: { type: "string", required: false, minLength: 1, maxLength: 1024 },
    error_code: { type: "string", required: false, minLength: 1, maxLength: 128 },
    error_description: { type: "string", required: false, minLength: 1, maxLength: 1024 }
  }),
  mode: "patch",
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
