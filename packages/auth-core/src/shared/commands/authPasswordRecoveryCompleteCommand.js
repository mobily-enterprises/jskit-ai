import { Type } from "typebox";
import { normalizeObjectInput } from "../inputNormalization.js";
import {
  authAccessTokenValidator,
  authRecoveryTokenValidator,
  authRefreshTokenValidator,
  createCommandMessages,
  okResponseValidator
} from "./authCommandValidators.js";

const AUTH_PASSWORD_RECOVERY_COMPLETE_MESSAGES = createCommandMessages({
  fields: {
    code: {
      default: "Recovery code is invalid."
    },
    tokenHash: {
      default: "Recovery token hash is invalid."
    },
    accessToken: {
      default: "Access token is invalid."
    },
    refreshToken: {
      default: "Refresh token is invalid."
    },
    type: {
      const: "Only recovery links are supported.",
      default: "Only recovery links are supported."
    }
  }
});

const authPasswordRecoveryCompleteBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      code: Type.Optional(authRecoveryTokenValidator.schema),
      tokenHash: Type.Optional(authRecoveryTokenValidator.schema),
      accessToken: Type.Optional(authAccessTokenValidator.schema),
      refreshToken: Type.Optional(authRefreshTokenValidator.schema),
      type: Type.Optional(Type.Literal("recovery"))
    },
    {
      additionalProperties: false,
      minProperties: 1
    }
  ),
  normalize: normalizeObjectInput,
  messages: AUTH_PASSWORD_RECOVERY_COMPLETE_MESSAGES
});

const authPasswordRecoveryCompleteCommand = Object.freeze({
  command: "auth.password.recovery.complete",
  operation: Object.freeze({
    method: "POST",
    bodyValidator: authPasswordRecoveryCompleteBodyValidator,
    responseValidator: okResponseValidator,
    messages: AUTH_PASSWORD_RECOVERY_COMPLETE_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export {
  authPasswordRecoveryCompleteBodyValidator,
  okResponseValidator,
  AUTH_PASSWORD_RECOVERY_COMPLETE_MESSAGES,
  authPasswordRecoveryCompleteCommand
};
