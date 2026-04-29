import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authEmailFieldDefinition,
  createCommandMessages,
  okMessageOutputValidator
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

const authRegisterConfirmationResendBodyValidator = deepFreeze({
  schema: createSchema({
    email: { ...authEmailFieldDefinition, required: true }
  }),
  mode: "create",
  messages: AUTH_REGISTER_CONFIRMATION_RESEND_MESSAGES
});

const authRegisterConfirmationResendCommand = deepFreeze({
  command: "auth.register.confirmation.resend",
  operation: {
    method: "POST",
    body: authRegisterConfirmationResendBodyValidator,
    response: okMessageOutputValidator,
    messages: AUTH_REGISTER_CONFIRMATION_RESEND_MESSAGES,
    idempotent: false,
    invalidates: []
  }
});

export {
  authRegisterConfirmationResendBodyValidator,
  AUTH_REGISTER_CONFIRMATION_RESEND_MESSAGES,
  authRegisterConfirmationResendCommand
};
