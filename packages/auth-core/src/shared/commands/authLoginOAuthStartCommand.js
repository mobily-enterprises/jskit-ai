import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  createCommandMessages,
  oauthProviderFieldDefinition,
  oauthReturnToFieldDefinition
} from "./authCommandValidators.js";

const AUTH_LOGIN_OAUTH_START_MESSAGES = createCommandMessages({
  fields: {
    provider: {
      required: "OAuth provider is required.",
      pattern: "OAuth provider id is invalid.",
      default: "OAuth provider id is invalid."
    },
    returnTo: {
      pattern: "Return target must be an absolute path or URL.",
      default: "Return target must be an absolute path or URL."
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

const authLoginOAuthStartResponseValidator = deepFreeze({
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
    response: authLoginOAuthStartResponseValidator,
    messages: AUTH_LOGIN_OAUTH_START_MESSAGES,
    idempotent: true,
    invalidates: []
  }
});

export {
  authLoginOAuthStartParamsValidator,
  authLoginOAuthStartQueryValidator,
  authLoginOAuthStartResponseValidator,
  AUTH_LOGIN_OAUTH_START_MESSAGES,
  authLoginOAuthStartCommand
};
