import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";
import {
  authPasswordSchema,
  createCommandMessages,
  okMessageResponseSchema
} from "./authCommandSchemaParts.js";

const authPasswordResetInputSchema = Type.Object(
  {
    password: authPasswordSchema
  },
  {
    additionalProperties: false
  }
);

const authPasswordResetOutputSchema = okMessageResponseSchema;

const AUTH_PASSWORD_RESET_MESSAGES = createCommandMessages({
  fields: {
    password: {
      required: "Password is required.",
      minLength: "Password must be at least 8 characters.",
      default: "Password must be at least 8 characters."
    }
  }
});

const authPasswordResetCommand = Object.freeze({
  command: "auth.password.reset",
  operation: Object.freeze({
    method: "POST",
    body: Object.freeze({
      schema: authPasswordResetInputSchema,
      normalize: normalizeObjectInput,
      messages: AUTH_PASSWORD_RESET_MESSAGES
    }),
    response: Object.freeze({
      schema: authPasswordResetOutputSchema
    }),
    messages: AUTH_PASSWORD_RESET_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export {
  authPasswordResetInputSchema,
  authPasswordResetOutputSchema,
  AUTH_PASSWORD_RESET_MESSAGES,
  authPasswordResetCommand
};
