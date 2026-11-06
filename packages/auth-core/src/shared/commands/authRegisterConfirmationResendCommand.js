import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authEmailFieldDefinition,
  AUTH_FIELD_MESSAGES,
  createCommandMessages,
  registerConfirmationResendOutputValidator
} from "./authCommandValidators.js";

const AUTH_REGISTER_CONFIRMATION_RESEND_MESSAGES = createCommandMessages({
  fields: {
    email: {
      required: AUTH_FIELD_MESSAGES.emailRequired,
      minLength: AUTH_FIELD_MESSAGES.emailRequired,
      pattern: AUTH_FIELD_MESSAGES.emailAddressInvalid,
      default: AUTH_FIELD_MESSAGES.emailAddressInvalid
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
    response: registerConfirmationResendOutputValidator,
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
