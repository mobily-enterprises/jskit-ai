import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  AUTH_FIELD_MESSAGES,
  createCommandMessages,
  oauthProviderFieldDefinition,
  oauthReturnToFieldDefinition
} from "./authCommandValidators.js";

const AUTH_LOGIN_OAUTH_START_MESSAGES = createCommandMessages({
  fields: {
    provider: {
      required: AUTH_FIELD_MESSAGES.oauthProviderRequired,
      pattern: AUTH_FIELD_MESSAGES.oauthProviderInvalid,
      default: AUTH_FIELD_MESSAGES.oauthProviderInvalid
    },
    returnTo: {
      pattern: AUTH_FIELD_MESSAGES.returnToInvalid,
      default: AUTH_FIELD_MESSAGES.returnToInvalid
    }
  }
});

const authLoginOAuthStartParamsValidator = deepFreeze({
  schema: createSchema({
    provider: { ...oauthProviderFieldDefinition, required: true }
  }),
  mode: "patch",
  messages: AUTH_LOGIN_OAUTH_START_MESSAGES
});

const authLoginOAuthStartQueryValidator = deepFreeze({
  schema: createSchema({
    returnTo: { ...oauthReturnToFieldDefinition, required: false }
  }),
  mode: "patch",
  messages: AUTH_LOGIN_OAUTH_START_MESSAGES
});

const authLoginOAuthStartOutputValidator = deepFreeze({
  schema: createSchema({
    provider: { ...oauthProviderFieldDefinition, required: true },
    returnTo: { ...oauthReturnToFieldDefinition, required: true },
    url: { type: "string", required: true, minLength: 1, maxLength: 4096 }
  }),
  mode: "replace"
});

const authLoginOAuthStartCommand = deepFreeze({
  command: "auth.login.oauth.start",
  operation: {
    method: "GET",
    params: authLoginOAuthStartParamsValidator,
    query: authLoginOAuthStartQueryValidator,
    response: authLoginOAuthStartOutputValidator,
    messages: AUTH_LOGIN_OAUTH_START_MESSAGES,
    idempotent: true,
    invalidates: []
  }
});

export {
  authLoginOAuthStartParamsValidator,
  authLoginOAuthStartQueryValidator,
  authLoginOAuthStartOutputValidator,
  AUTH_LOGIN_OAUTH_START_MESSAGES,
  authLoginOAuthStartCommand
};
