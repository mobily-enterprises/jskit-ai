import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authEmailFieldDefinition,
  AUTH_FIELD_MESSAGES,
  createCommandMessages,
  okMessageOutputValidator
} from "./authCommandValidators.js";

const AUTH_PASSWORD_RESET_REQUEST_MESSAGES = createCommandMessages({
  fields: {
    email: {
      required: AUTH_FIELD_MESSAGES.emailRequired,
      minLength: AUTH_FIELD_MESSAGES.emailRequired,
      pattern: AUTH_FIELD_MESSAGES.emailAddressInvalid,
      default: AUTH_FIELD_MESSAGES.emailAddressInvalid
    }
  }
});

const authPasswordResetRequestBodyValidator = deepFreeze({
  schema: createSchema({
    email: { ...authEmailFieldDefinition, required: true }
  }),
  mode: "create",
  messages: AUTH_PASSWORD_RESET_REQUEST_MESSAGES
});

const authPasswordResetRequestCommand = deepFreeze({
  command: "auth.password.reset.request",
  operation: {
    method: "POST",
    body: authPasswordResetRequestBodyValidator,
    response: okMessageOutputValidator,
    messages: AUTH_PASSWORD_RESET_REQUEST_MESSAGES,
    idempotent: false,
    invalidates: []
  }
});

export {
  authPasswordResetRequestBodyValidator,
  okMessageOutputValidator,
  AUTH_PASSWORD_RESET_REQUEST_MESSAGES,
  authPasswordResetRequestCommand
};
