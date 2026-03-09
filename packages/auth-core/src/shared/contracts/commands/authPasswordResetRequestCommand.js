import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";
import {
  authEmailSchema,
  createCommandMessages,
  okMessageResponseSchema
} from "./authCommandSchemaParts.js";

const authPasswordResetRequestInputSchema = Type.Object(
  {
    email: authEmailSchema
  },
  {
    additionalProperties: false
  }
);

const authPasswordResetRequestOutputSchema = okMessageResponseSchema;

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

const authPasswordResetRequestCommand = Object.freeze({
  command: "auth.password.reset.request",
  operation: Object.freeze({
    method: "POST",
    body: Object.freeze({
      schema: authPasswordResetRequestInputSchema,
      normalize: normalizeObjectInput,
      messages: AUTH_PASSWORD_RESET_REQUEST_MESSAGES
    }),
    response: Object.freeze({
      schema: authPasswordResetRequestOutputSchema
    }),
    messages: AUTH_PASSWORD_RESET_REQUEST_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze([])
  })
});

export {
  authPasswordResetRequestInputSchema,
  authPasswordResetRequestOutputSchema,
  AUTH_PASSWORD_RESET_REQUEST_MESSAGES,
  authPasswordResetRequestCommand
};
