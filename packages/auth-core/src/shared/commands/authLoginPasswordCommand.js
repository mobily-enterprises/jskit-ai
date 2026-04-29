import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authEmailFieldDefinition,
  authLoginPasswordFieldDefinition,
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

const authLoginPasswordBodyValidator = deepFreeze({
  schema: createSchema({
    email: { ...authEmailFieldDefinition, required: true },
    password: { ...authLoginPasswordFieldDefinition, required: true }
  }),
  mode: "create",
  messages: AUTH_LOGIN_PASSWORD_MESSAGES
});

const authLoginPasswordCommand = deepFreeze({
  command: "auth.login.password",
  operation: {
    method: "POST",
    body: authLoginPasswordBodyValidator,
    response: loginResponseValidator,
    messages: AUTH_LOGIN_PASSWORD_MESSAGES,
    idempotent: false,
    invalidates: ["auth.session.read"]
  }
});

export {
  authLoginPasswordBodyValidator,
  loginResponseValidator,
  AUTH_LOGIN_PASSWORD_MESSAGES,
  authLoginPasswordCommand
};
