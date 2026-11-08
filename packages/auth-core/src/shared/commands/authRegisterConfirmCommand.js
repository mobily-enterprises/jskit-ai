import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authLoginPasswordFieldDefinition,
  authRecoveryTokenValidator,
  AUTH_FIELD_MESSAGES,
  createCommandMessages,
  registerConfirmOutputValidator
} from "./authCommandValidators.js";

const AUTH_REGISTER_CONFIRM_MESSAGES = createCommandMessages({
  fields: {
    token: {
      required: AUTH_FIELD_MESSAGES.confirmationCodeRequired,
      minLength: AUTH_FIELD_MESSAGES.confirmationCodeRequired,
      default: AUTH_FIELD_MESSAGES.confirmationCodeRequired
    },
    password: {
      required: AUTH_FIELD_MESSAGES.passwordRequired,
      minLength: AUTH_FIELD_MESSAGES.passwordRequired,
      default: AUTH_FIELD_MESSAGES.passwordRequired
    }
  }
});

// The code from a registration's confirmation link, with the password the
// registration was made with: confirming creates the account and signs the
// person in. The link proves the email; the password proves the registration
// is the confirming person's own.
const authRegisterConfirmBodyValidator = deepFreeze({
  schema: createSchema({
    token: { ...authRecoveryTokenValidator, required: true },
    password: { ...authLoginPasswordFieldDefinition, required: true }
  }),
  mode: "create",
  messages: AUTH_REGISTER_CONFIRM_MESSAGES
});

const authRegisterConfirmCommand = deepFreeze({
  command: "auth.register.confirm",
  operation: {
    method: "POST",
    body: authRegisterConfirmBodyValidator,
    response: registerConfirmOutputValidator,
    messages: AUTH_REGISTER_CONFIRM_MESSAGES,
    idempotent: false,
    invalidates: ["auth.session.read"]
  }
});

export { authRegisterConfirmBodyValidator, AUTH_REGISTER_CONFIRM_MESSAGES, authRegisterConfirmCommand };
