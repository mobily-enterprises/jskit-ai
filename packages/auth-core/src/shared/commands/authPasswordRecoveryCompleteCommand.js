import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
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

const authPasswordRecoveryCompleteBodyValidator = deepFreeze({
  schema: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: {
      code: authRecoveryTokenValidator.schema,
      tokenHash: authRecoveryTokenValidator.schema,
      accessToken: authAccessTokenValidator.schema,
      refreshToken: authRefreshTokenValidator.schema,
      type: {
        type: "string",
        enum: ["recovery"]
      }
    }
  },
  messages: AUTH_PASSWORD_RECOVERY_COMPLETE_MESSAGES
});

const authPasswordRecoveryCompleteCommand = deepFreeze({
  command: "auth.password.recovery.complete",
  operation: {
    method: "POST",
    body: authPasswordRecoveryCompleteBodyValidator,
    response: okResponseValidator,
    messages: AUTH_PASSWORD_RECOVERY_COMPLETE_MESSAGES,
    idempotent: false,
    invalidates: ["auth.session.read"]
  }
});

export {
  authPasswordRecoveryCompleteBodyValidator,
  okResponseValidator,
  AUTH_PASSWORD_RECOVERY_COMPLETE_MESSAGES,
  authPasswordRecoveryCompleteCommand
};
