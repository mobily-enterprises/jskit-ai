import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authAccessTokenValidator,
  authRecoveryTokenValidator,
  authRefreshTokenValidator,
  createCommandMessages,
  okOutputValidator
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
  schema: createSchema({
    code: {
      ...authRecoveryTokenValidator,
      required: false
    },
    tokenHash: {
      ...authRecoveryTokenValidator,
      required: false
    },
    accessToken: {
      ...authAccessTokenValidator,
      required: false
    },
    refreshToken: {
      ...authRefreshTokenValidator,
      required: false
    },
    type: {
      type: "string",
      required: false,
      enum: ["recovery"]
    }
  }),
  mode: "patch",
  messages: AUTH_PASSWORD_RECOVERY_COMPLETE_MESSAGES
});

const authPasswordRecoveryCompleteCommand = deepFreeze({
  command: "auth.password.recovery.complete",
  operation: {
    method: "POST",
    body: authPasswordRecoveryCompleteBodyValidator,
    response: okOutputValidator,
    messages: AUTH_PASSWORD_RECOVERY_COMPLETE_MESSAGES,
    idempotent: false,
    invalidates: ["auth.session.read"]
  }
});

export {
  authPasswordRecoveryCompleteBodyValidator,
  okOutputValidator,
  AUTH_PASSWORD_RECOVERY_COMPLETE_MESSAGES,
  authPasswordRecoveryCompleteCommand
};
