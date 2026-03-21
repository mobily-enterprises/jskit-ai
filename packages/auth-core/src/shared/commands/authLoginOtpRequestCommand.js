import { Type } from "typebox";
import { normalizeObjectInput } from "../inputNormalization.js";
import {
  authEmailValidator,
  createCommandMessages,
  oauthReturnToValidator,
  okMessageResponseValidator
} from "./authCommandValidators.js";

const AUTH_LOGIN_OTP_REQUEST_MESSAGES = createCommandMessages({
  fields: {
    email: {
      required: "Email is required.",
      minLength: "Email is required.",
      pattern: "Enter a valid email address.",
      default: "Enter a valid email address."
    },
    returnTo: {
      pattern: "Return target must be an absolute path or URL.",
      default: "Return target must be an absolute path or URL."
    }
  }
});

const authLoginOtpRequestBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      email: authEmailValidator.schema,
      returnTo: Type.Optional(oauthReturnToValidator.schema)
    },
    {
      additionalProperties: false
    }
  ),
  normalize: normalizeObjectInput,
  messages: AUTH_LOGIN_OTP_REQUEST_MESSAGES
});

const authLoginOtpRequestCommand = Object.freeze({
  command: "auth.login.otp.request",
  operation: Object.freeze({
    method: "POST",
    bodyValidator: authLoginOtpRequestBodyValidator,
    responseValidator: okMessageResponseValidator,
    messages: AUTH_LOGIN_OTP_REQUEST_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze([])
  })
});

export {
  authLoginOtpRequestBodyValidator,
  okMessageResponseValidator,
  AUTH_LOGIN_OTP_REQUEST_MESSAGES,
  authLoginOtpRequestCommand
};
