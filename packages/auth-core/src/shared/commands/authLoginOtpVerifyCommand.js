import { Type } from "typebox";
import { normalizeObjectInput } from "../inputNormalization.js";
import {
  authEmailValidator,
  authRecoveryTokenValidator,
  createCommandMessages,
  otpVerifyResponseValidator
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

const authLoginOtpVerifyBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      email: Type.Optional(authEmailValidator.schema),
      token: Type.Optional(authRecoveryTokenValidator.schema),
      tokenHash: Type.Optional(authRecoveryTokenValidator.schema),
      type: Type.Optional(Type.Literal("email"))
    },
    {
      additionalProperties: false,
      minProperties: 1
    }
  ),
  normalize: normalizeObjectInput,
  messages: AUTH_LOGIN_OTP_VERIFY_MESSAGES
});

const authLoginOtpVerifyCommand = Object.freeze({
  command: "auth.login.otp.verify",
  operation: Object.freeze({
    method: "POST",
    body: authLoginOtpVerifyBodyValidator,
    response: otpVerifyResponseValidator,
    messages: AUTH_LOGIN_OTP_VERIFY_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export {
  authLoginOtpVerifyBodyValidator,
  otpVerifyResponseValidator,
  AUTH_LOGIN_OTP_VERIFY_MESSAGES,
  authLoginOtpVerifyCommand
};
