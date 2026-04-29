import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authPasswordFieldDefinition,
  createCommandMessages,
  okMessageResponseValidator
} from "./authCommandValidators.js";

const AUTH_PASSWORD_RESET_MESSAGES = createCommandMessages({
  fields: {
    password: {
      required: "Password is required.",
      minLength: "Password must be at least 8 characters.",
      default: "Password must be at least 8 characters."
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
    response: okMessageResponseValidator,
    messages: AUTH_PASSWORD_RESET_MESSAGES,
    idempotent: false,
    invalidates: ["auth.session.read"]
  }
});

export {
  authPasswordResetBodyValidator,
  okMessageResponseValidator,
  AUTH_PASSWORD_RESET_MESSAGES,
  authPasswordResetCommand
};
