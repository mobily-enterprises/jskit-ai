import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authEmailValidator,
  authRecoveryTokenValidator,
  createCommandMessages,
  otpVerifyOutputValidator
} from "./authCommandValidators.js";

const AUTH_LOGIN_OTP_VERIFY_MESSAGES = createCommandMessages({
  fields: {
    email: {
      pattern: "Enter a valid email address.",
      default: "Enter a valid email address."
    },
    token: {
      minLength: "One-time code is required.",
      default: "One-time code is required."
    },
    tokenHash: {
      default: "One-time token hash is invalid."
    },
    type: {
      const: "Only email OTP verification is supported.",
      default: "Only email OTP verification is supported."
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
  mode: "patch",
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
