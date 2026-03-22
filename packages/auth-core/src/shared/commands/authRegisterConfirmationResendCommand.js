import { Type } from "typebox";
import { normalizeObjectInput } from "../inputNormalization.js";
import {
  authEmailValidator,
  createCommandMessages,
  okMessageResponseValidator
} from "./authCommandValidators.js";

const AUTH_REGISTER_CONFIRMATION_RESEND_MESSAGES = createCommandMessages({
  fields: {
    email: {
      required: "Email is required.",
      minLength: "Email is required.",
      pattern: "Enter a valid email address.",
      default: "Enter a valid email address."
    }
  }
});

const authRegisterConfirmationResendBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      email: authEmailValidator.schema
    },
    {
      additionalProperties: false
    }
  ),
  normalize: normalizeObjectInput,
  messages: AUTH_REGISTER_CONFIRMATION_RESEND_MESSAGES
});

const authRegisterConfirmationResendCommand = Object.freeze({
  command: "auth.register.confirmation.resend",
  operation: Object.freeze({
    method: "POST",
    bodyValidator: authRegisterConfirmationResendBodyValidator,
    responseValidator: okMessageResponseValidator,
    messages: AUTH_REGISTER_CONFIRMATION_RESEND_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze([])
  })
});

export {
  authRegisterConfirmationResendBodyValidator,
  AUTH_REGISTER_CONFIRMATION_RESEND_MESSAGES,
  authRegisterConfirmationResendCommand
};
