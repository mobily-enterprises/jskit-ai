import { Type } from "typebox";
import { normalizeObjectInput } from "../inputNormalization.js";
import {
  authEmailValidator,
  authLoginPasswordValidator,
  createCommandMessages,
  loginResponseValidator
} from "./authCommandValidators.js";

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

const authLoginPasswordBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      email: authEmailValidator.schema,
      password: authLoginPasswordValidator.schema
    },
    {
      additionalProperties: false
    }
  ),
  normalize: normalizeObjectInput,
  messages: AUTH_LOGIN_PASSWORD_MESSAGES
});

const authLoginPasswordCommand = Object.freeze({
  command: "auth.login.password",
  operation: Object.freeze({
    method: "POST",
    body: authLoginPasswordBodyValidator,
    response: loginResponseValidator,
    messages: AUTH_LOGIN_PASSWORD_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export {
  authLoginPasswordBodyValidator,
  loginResponseValidator,
  AUTH_LOGIN_PASSWORD_MESSAGES,
  authLoginPasswordCommand
};
