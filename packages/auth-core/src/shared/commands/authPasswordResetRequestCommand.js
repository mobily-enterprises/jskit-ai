import { Type } from "typebox";
import { normalizeObjectInput } from "../inputNormalization.js";
import {
  authEmailValidator,
  createCommandMessages,
  okMessageResponseValidator
} from "./authCommandValidators.js";

const AUTH_PASSWORD_RESET_REQUEST_MESSAGES = createCommandMessages({
  fields: {
    email: {
      required: "Email is required.",
      minLength: "Email is required.",
      pattern: "Enter a valid email address.",
      default: "Enter a valid email address."
    }
  }
});

const authPasswordResetRequestBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      email: authEmailValidator.schema
    },
    {
      additionalProperties: false
    }
  ),
  normalize: normalizeObjectInput,
  messages: AUTH_PASSWORD_RESET_REQUEST_MESSAGES
});

const authPasswordResetRequestCommand = Object.freeze({
  command: "auth.password.reset.request",
  operation: Object.freeze({
    method: "POST",
    body: authPasswordResetRequestBodyValidator,
    response: okMessageResponseValidator,
    messages: AUTH_PASSWORD_RESET_REQUEST_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze([])
  })
});

export {
  authPasswordResetRequestBodyValidator,
  okMessageResponseValidator,
  AUTH_PASSWORD_RESET_REQUEST_MESSAGES,
  authPasswordResetRequestCommand
};
