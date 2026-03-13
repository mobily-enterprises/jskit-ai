import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";
import {
  createCommandMessages,
  oauthProviderSchema,
  oauthReturnToSchema
} from "./authCommandSchemas.js";

const authLoginOAuthStartParamsSchema = Type.Object(
  {
    provider: oauthProviderSchema
  },
  {
    additionalProperties: false
  }
);

const authLoginOAuthStartQuerySchema = Type.Object(
  {
    returnTo: Type.Optional(oauthReturnToSchema)
  },
  {
    additionalProperties: false
  }
);

const authLoginOAuthStartOutputSchema = Type.Unknown();

const AUTH_LOGIN_OAUTH_START_MESSAGES = createCommandMessages({
  fields: {
    provider: {
      required: "OAuth provider is required.",
      pattern: "OAuth provider id is invalid.",
      default: "OAuth provider id is invalid."
    },
    returnTo: {
      pattern: "Return path must start with '/'.",
      default: "Return path must start with '/'."
    }
  }
});

const authLoginOAuthStartCommand = Object.freeze({
  command: "auth.login.oauth.start",
  operation: Object.freeze({
    method: "GET",
    params: Object.freeze({
      schema: authLoginOAuthStartParamsSchema,
      normalize: normalizeObjectInput,
      messages: AUTH_LOGIN_OAUTH_START_MESSAGES
    }),
    query: Object.freeze({
      schema: authLoginOAuthStartQuerySchema,
      normalize: normalizeObjectInput,
      messages: AUTH_LOGIN_OAUTH_START_MESSAGES
    }),
    response: Object.freeze({
      schema: authLoginOAuthStartOutputSchema
    }),
    messages: AUTH_LOGIN_OAUTH_START_MESSAGES,
    idempotent: true,
    invalidates: Object.freeze([])
  })
});

export {
  authLoginOAuthStartParamsSchema,
  authLoginOAuthStartQuerySchema,
  authLoginOAuthStartOutputSchema,
  AUTH_LOGIN_OAUTH_START_MESSAGES,
  authLoginOAuthStartCommand
};
