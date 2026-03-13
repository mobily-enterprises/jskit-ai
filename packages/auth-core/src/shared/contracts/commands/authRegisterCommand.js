import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";
import {
  authEmailSchema,
  authPasswordSchema,
  createCommandMessages,
  registerResponseSchema
} from "./authCommandSchemas.js";

const authRegisterInputSchema = Type.Object(
  {
    email: authEmailSchema,
    password: authPasswordSchema
  },
  {
    additionalProperties: false
  }
);

const authRegisterOutputSchema = registerResponseSchema;

const AUTH_REGISTER_MESSAGES = createCommandMessages({
  fields: {
    email: {
      required: "Email is required.",
      minLength: "Email is required.",
      pattern: "Enter a valid email address.",
      default: "Enter a valid email address."
    },
    password: {
      required: "Password is required.",
      minLength: "Password must be at least 8 characters.",
      default: "Password must be at least 8 characters."
    }
  }
});

const authRegisterCommand = Object.freeze({
  command: "auth.register",
  operation: Object.freeze({
    method: "POST",
    body: Object.freeze({
      schema: authRegisterInputSchema,
      normalize: normalizeObjectInput,
      messages: AUTH_REGISTER_MESSAGES
    }),
    response: Object.freeze({
      schema: authRegisterOutputSchema
    }),
    messages: AUTH_REGISTER_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export {
  authRegisterInputSchema,
  authRegisterOutputSchema,
  AUTH_REGISTER_MESSAGES,
  authRegisterCommand
};
