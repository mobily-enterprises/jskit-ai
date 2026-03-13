import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";
import {
  authEmailSchema,
  createCommandMessages,
  oauthReturnToSchema,
  okMessageResponseSchema
} from "./authCommandSchemas.js";

const authLoginOtpRequestInputSchema = Type.Object(
  {
    email: authEmailSchema,
    returnTo: Type.Optional(oauthReturnToSchema)
  },
  {
    additionalProperties: false
  }
);

const authLoginOtpRequestOutputSchema = okMessageResponseSchema;

const AUTH_LOGIN_OTP_REQUEST_MESSAGES = createCommandMessages({
  fields: {
    email: {
      required: "Email is required.",
      minLength: "Email is required.",
      pattern: "Enter a valid email address.",
      default: "Enter a valid email address."
    },
    returnTo: {
      pattern: "Return path must start with '/'.",
      default: "Return path must start with '/'."
    }
  }
});

const authLoginOtpRequestCommand = Object.freeze({
  command: "auth.login.otp.request",
  operation: Object.freeze({
    method: "POST",
    body: Object.freeze({
      schema: authLoginOtpRequestInputSchema,
      normalize: normalizeObjectInput,
      messages: AUTH_LOGIN_OTP_REQUEST_MESSAGES
    }),
    response: Object.freeze({
      schema: authLoginOtpRequestOutputSchema
    }),
    messages: AUTH_LOGIN_OTP_REQUEST_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze([])
  })
});

export {
  authLoginOtpRequestInputSchema,
  authLoginOtpRequestOutputSchema,
  AUTH_LOGIN_OTP_REQUEST_MESSAGES,
  authLoginOtpRequestCommand
};
