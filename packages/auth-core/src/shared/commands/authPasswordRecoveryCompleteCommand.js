import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authAccessTokenValidator,
  authRecoveryTokenValidator,
  authRefreshTokenValidator,
  AUTH_FIELD_MESSAGES,
  createCommandMessages,
  okOutputValidator
} from "./authCommandValidators.js";

const AUTH_PASSWORD_RECOVERY_COMPLETE_MESSAGES = createCommandMessages({
  fields: {
    code: {
      default: AUTH_FIELD_MESSAGES.recoveryCodeInvalid
    },
    tokenHash: {
      default: AUTH_FIELD_MESSAGES.recoveryTokenHashInvalid
    },
    accessToken: {
      default: AUTH_FIELD_MESSAGES.accessTokenInvalid
    },
    refreshToken: {
      default: AUTH_FIELD_MESSAGES.refreshTokenInvalid
    },
    type: {
      const: AUTH_FIELD_MESSAGES.recoveryTypeUnsupported,
      default: AUTH_FIELD_MESSAGES.recoveryTypeUnsupported
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
  mode: "create",
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
