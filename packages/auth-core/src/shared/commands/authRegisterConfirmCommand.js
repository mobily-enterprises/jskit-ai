import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
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
    }
  }
});

// The code from a registration's confirmation link: confirming it creates the
// account and signs the person in.
const authRegisterConfirmBodyValidator = deepFreeze({
  schema: createSchema({
    token: { ...authRecoveryTokenValidator, required: true }
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
