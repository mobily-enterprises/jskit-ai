import { Type } from "typebox";
import { normalizeObjectInput } from "../inputNormalization.js";
import {
  authEmailValidator,
  authPasswordValidator,
  createCommandMessages,
  registerResponseValidator
} from "./authCommandValidators.js";

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

const authRegisterBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      email: authEmailValidator.schema,
      password: authPasswordValidator.schema
    },
    {
      additionalProperties: false
    }
  ),
  normalize: normalizeObjectInput,
  messages: AUTH_REGISTER_MESSAGES
});

const authRegisterCommand = Object.freeze({
  command: "auth.register",
  operation: Object.freeze({
    method: "POST",
    bodyValidator: authRegisterBodyValidator,
    responseValidator: registerResponseValidator,
    messages: AUTH_REGISTER_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export {
  authRegisterBodyValidator,
  registerResponseValidator,
  AUTH_REGISTER_MESSAGES,
  authRegisterCommand
};
