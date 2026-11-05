import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authPasswordFieldDefinition,
  AUTH_FIELD_MESSAGES,
  createCommandMessages,
  okMessageOutputValidator
} from "./authCommandValidators.js";

const AUTH_PASSWORD_RESET_MESSAGES = createCommandMessages({
  fields: {
    password: {
      required: AUTH_FIELD_MESSAGES.passwordRequired,
      minLength: AUTH_FIELD_MESSAGES.passwordMinLength,
      default: AUTH_FIELD_MESSAGES.passwordMinLength
    }
  }
});

const authPasswordResetBodyValidator = deepFreeze({
  schema: createSchema({
    password: { ...authPasswordFieldDefinition, required: true }
  }),
  mode: "create",
  messages: AUTH_PASSWORD_RESET_MESSAGES
});

const authPasswordResetCommand = deepFreeze({
  command: "auth.password.reset",
  operation: {
    method: "POST",
    body: authPasswordResetBodyValidator,
    response: okMessageOutputValidator,
    messages: AUTH_PASSWORD_RESET_MESSAGES,
    idempotent: false,
    invalidates: ["auth.session.read"]
  }
});

export {
  authPasswordResetBodyValidator,
  okMessageOutputValidator,
  AUTH_PASSWORD_RESET_MESSAGES,
  authPasswordResetCommand
};
