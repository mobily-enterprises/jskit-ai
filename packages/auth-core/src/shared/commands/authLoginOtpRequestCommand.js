import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authEmailFieldDefinition,
  AUTH_FIELD_MESSAGES,
  createCommandMessages,
  oauthReturnToFieldDefinition,
  okMessageOutputValidator
} from "./authCommandValidators.js";

const AUTH_LOGIN_OTP_REQUEST_MESSAGES = createCommandMessages({
  fields: {
    email: {
      required: AUTH_FIELD_MESSAGES.emailRequired,
      minLength: AUTH_FIELD_MESSAGES.emailRequired,
      pattern: AUTH_FIELD_MESSAGES.emailAddressInvalid,
      default: AUTH_FIELD_MESSAGES.emailAddressInvalid
    },
    returnTo: {
      pattern: AUTH_FIELD_MESSAGES.returnToInvalid,
      default: AUTH_FIELD_MESSAGES.returnToInvalid
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
    response: okMessageOutputValidator,
    messages: AUTH_LOGIN_OTP_REQUEST_MESSAGES,
    idempotent: false,
    invalidates: []
  }
});

export {
  authLoginOtpRequestBodyValidator,
  okMessageOutputValidator,
  AUTH_LOGIN_OTP_REQUEST_MESSAGES,
  authLoginOtpRequestCommand
};
