import { Type } from "typebox";
import { normalizeObjectInput } from "../inputNormalization.js";
import {
  createCommandMessages,
  oauthProviderValidator,
  oauthReturnToValidator
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

const authLoginOAuthStartParamsValidator = Object.freeze({
  schema: Type.Object(
    {
      provider: oauthProviderValidator.schema
    },
    {
      additionalProperties: false
    }
  ),
  normalize: normalizeObjectInput,
  messages: AUTH_LOGIN_OAUTH_START_MESSAGES
});

const authLoginOAuthStartQueryValidator = Object.freeze({
  schema: Type.Object(
    {
      returnTo: Type.Optional(oauthReturnToValidator.schema)
    },
    {
      additionalProperties: false
    }
  ),
  normalize: normalizeObjectInput,
  messages: AUTH_LOGIN_OAUTH_START_MESSAGES
});

const authLoginOAuthStartResponseValidator = Object.freeze({
  schema: Type.Unknown()
});

const authLoginOAuthStartCommand = Object.freeze({
  command: "auth.login.oauth.start",
  operation: Object.freeze({
    method: "GET",
    paramsValidator: authLoginOAuthStartParamsValidator,
    queryValidator: authLoginOAuthStartQueryValidator,
    responseValidator: authLoginOAuthStartResponseValidator,
    messages: AUTH_LOGIN_OAUTH_START_MESSAGES,
    idempotent: true,
    invalidates: Object.freeze([])
  })
});

export {
  authLoginOAuthStartParamsValidator,
  authLoginOAuthStartQueryValidator,
  authLoginOAuthStartResponseValidator,
  AUTH_LOGIN_OAUTH_START_MESSAGES,
  authLoginOAuthStartCommand
};
