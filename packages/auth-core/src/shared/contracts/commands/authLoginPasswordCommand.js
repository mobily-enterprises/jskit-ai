import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";
import {
  authEmailSchema,
  authLoginPasswordSchema,
  createCommandMessages,
  loginResponseSchema
} from "./authCommandSchemas.js";

const authLoginPasswordInputSchema = Type.Object(
  {
    email: authEmailSchema,
    password: authLoginPasswordSchema
  },
  {
    additionalProperties: false
  }
);

const authLoginPasswordOutputSchema = loginResponseSchema;

const AUTH_LOGIN_PASSWORD_MESSAGES = createCommandMessages({
  fields: {
    email: {
      required: "Email is required.",
      minLength: "Email is required.",
      pattern: "Enter a valid email address.",
      default: "Enter a valid email address."
    },
    password: {
      required: "Password is required.",
      minLength: "Password is required.",
      default: "Password is required."
    }
  }
});

const authLoginPasswordCommand = Object.freeze({
  command: "auth.login.password",
  operation: Object.freeze({
    method: "POST",
    body: Object.freeze({
      schema: authLoginPasswordInputSchema,
      normalize: normalizeObjectInput,
      messages: AUTH_LOGIN_PASSWORD_MESSAGES
    }),
    response: Object.freeze({
      schema: authLoginPasswordOutputSchema
    }),
    messages: AUTH_LOGIN_PASSWORD_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export {
  authLoginPasswordInputSchema,
  authLoginPasswordOutputSchema,
  AUTH_LOGIN_PASSWORD_MESSAGES,
  authLoginPasswordCommand
};
