import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";
import {
  authEmailSchema,
  authRecoveryTokenSchema,
  createCommandMessages,
  otpVerifyResponseSchema
} from "./authCommandSchemas.js";

const authLoginOtpVerifyInputSchema = Type.Object(
  {
    email: Type.Optional(authEmailSchema),
    token: Type.Optional(authRecoveryTokenSchema),
    tokenHash: Type.Optional(authRecoveryTokenSchema),
    type: Type.Optional(Type.Literal("email"))
  },
  {
    additionalProperties: false,
    minProperties: 1
  }
);

const authLoginOtpVerifyOutputSchema = otpVerifyResponseSchema;

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

const authLoginOtpVerifyCommand = Object.freeze({
  command: "auth.login.otp.verify",
  operation: Object.freeze({
    method: "POST",
    body: Object.freeze({
      schema: authLoginOtpVerifyInputSchema,
      normalize: normalizeObjectInput,
      messages: AUTH_LOGIN_OTP_VERIFY_MESSAGES
    }),
    response: Object.freeze({
      schema: authLoginOtpVerifyOutputSchema
    }),
    messages: AUTH_LOGIN_OTP_VERIFY_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export {
  authLoginOtpVerifyInputSchema,
  authLoginOtpVerifyOutputSchema,
  AUTH_LOGIN_OTP_VERIFY_MESSAGES,
  authLoginOtpVerifyCommand
};
