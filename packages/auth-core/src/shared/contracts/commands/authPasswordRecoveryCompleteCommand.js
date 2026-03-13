import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";
import {
  authAccessTokenSchema,
  authRecoveryTokenSchema,
  authRefreshTokenSchema,
  createCommandMessages,
  okResponseSchema
} from "./authCommandSchemas.js";

const authPasswordRecoveryCompleteInputSchema = Type.Object(
  {
    code: Type.Optional(authRecoveryTokenSchema),
    tokenHash: Type.Optional(authRecoveryTokenSchema),
    accessToken: Type.Optional(authAccessTokenSchema),
    refreshToken: Type.Optional(authRefreshTokenSchema),
    type: Type.Optional(Type.Literal("recovery"))
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const authPasswordRecoveryCompleteOutputSchema = okResponseSchema;

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

const authPasswordRecoveryCompleteCommand = Object.freeze({
  command: "auth.password.recovery.complete",
  operation: Object.freeze({
    method: "POST",
    body: Object.freeze({
      schema: authPasswordRecoveryCompleteInputSchema,
      normalize: normalizeObjectInput,
      messages: AUTH_PASSWORD_RECOVERY_COMPLETE_MESSAGES
    }),
    response: Object.freeze({
      schema: authPasswordRecoveryCompleteOutputSchema
    }),
    messages: AUTH_PASSWORD_RECOVERY_COMPLETE_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export {
  authPasswordRecoveryCompleteInputSchema,
  authPasswordRecoveryCompleteOutputSchema,
  AUTH_PASSWORD_RECOVERY_COMPLETE_MESSAGES,
  authPasswordRecoveryCompleteCommand
};
