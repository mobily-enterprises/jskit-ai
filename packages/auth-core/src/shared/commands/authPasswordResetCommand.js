import { Type } from "typebox";
import { normalizeObjectInput } from "../inputNormalization.js";
import {
  authPasswordValidator,
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

const authPasswordResetBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      password: authPasswordValidator.schema
    },
    {
      additionalProperties: false
    }
  ),
  normalize: normalizeObjectInput,
  messages: AUTH_PASSWORD_RESET_MESSAGES
});

const authPasswordResetCommand = Object.freeze({
  command: "auth.password.reset",
  operation: Object.freeze({
    method: "POST",
    bodyValidator: authPasswordResetBodyValidator,
    responseValidator: okMessageResponseValidator,
    messages: AUTH_PASSWORD_RESET_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export {
  authPasswordResetBodyValidator,
  okMessageResponseValidator,
  AUTH_PASSWORD_RESET_MESSAGES,
  authPasswordResetCommand
};
