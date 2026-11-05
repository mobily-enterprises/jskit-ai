import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authEmailValidator,
  authRecoveryTokenValidator,
  AUTH_FIELD_MESSAGES,
  createCommandMessages,
  otpVerifyOutputValidator
} from "./authCommandValidators.js";

const AUTH_LOGIN_OTP_VERIFY_MESSAGES = createCommandMessages({
  fields: {
    email: {
      pattern: AUTH_FIELD_MESSAGES.emailAddressInvalid,
      default: AUTH_FIELD_MESSAGES.emailAddressInvalid
    },
    token: {
      minLength: AUTH_FIELD_MESSAGES.otpCodeRequired,
      default: AUTH_FIELD_MESSAGES.otpCodeRequired
    },
    tokenHash: {
      default: AUTH_FIELD_MESSAGES.otpTokenHashInvalid
    },
    type: {
      const: AUTH_FIELD_MESSAGES.otpTypeUnsupported,
      default: AUTH_FIELD_MESSAGES.otpTypeUnsupported
    }
  }
});

const authLoginOtpVerifyBodyValidator = deepFreeze({
  schema: createSchema({
    email: {
      ...authEmailValidator,
      required: false
    },
    token: {
      ...authRecoveryTokenValidator,
      required: false
    },
    tokenHash: {
      ...authRecoveryTokenValidator,
      required: false
    },
    type: {
      type: "string",
      required: false,
      enum: ["email"]
    }
  }),
  mode: "create",
  messages: AUTH_LOGIN_OTP_VERIFY_MESSAGES
});

const authLoginOtpVerifyCommand = deepFreeze({
  command: "auth.login.otp.verify",
  operation: {
    method: "POST",
    body: authLoginOtpVerifyBodyValidator,
    response: otpVerifyOutputValidator,
    messages: AUTH_LOGIN_OTP_VERIFY_MESSAGES,
    idempotent: false,
    invalidates: ["auth.session.read"]
  }
});

export {
  authLoginOtpVerifyBodyValidator,
  otpVerifyOutputValidator,
  AUTH_LOGIN_OTP_VERIFY_MESSAGES,
  authLoginOtpVerifyCommand
};
