import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authEmailFieldDefinition,
  createCommandMessages,
  oauthReturnToFieldDefinition,
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

const authLoginOtpRequestBodyValidator = deepFreeze({
  schema: createSchema({
    email: { ...authEmailFieldDefinition, required: true },
    returnTo: { ...oauthReturnToFieldDefinition, required: false }
  }),
  mode: "create",
  messages: AUTH_LOGIN_OTP_REQUEST_MESSAGES
});

const authLoginOtpRequestCommand = deepFreeze({
  command: "auth.login.otp.request",
  operation: {
    method: "POST",
    body: authLoginOtpRequestBodyValidator,
    response: okMessageResponseValidator,
    messages: AUTH_LOGIN_OTP_REQUEST_MESSAGES,
    idempotent: false,
    invalidates: []
  }
});

export {
  authLoginOtpRequestBodyValidator,
  okMessageResponseValidator,
  AUTH_LOGIN_OTP_REQUEST_MESSAGES,
  authLoginOtpRequestCommand
};
