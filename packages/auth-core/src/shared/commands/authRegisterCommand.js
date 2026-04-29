import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authEmailFieldDefinition,
  authPasswordFieldDefinition,
  createCommandMessages,
  registerOutputValidator
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

const authRegisterBodyValidator = deepFreeze({
  schema: createSchema({
    email: { ...authEmailFieldDefinition, required: true },
    password: { ...authPasswordFieldDefinition, required: true }
  }),
  mode: "create",
  messages: AUTH_REGISTER_MESSAGES
});

const authRegisterCommand = deepFreeze({
  command: "auth.register",
  operation: {
    method: "POST",
    body: authRegisterBodyValidator,
    response: registerOutputValidator,
    messages: AUTH_REGISTER_MESSAGES,
    idempotent: false,
    invalidates: ["auth.session.read"]
  }
});

export {
  authRegisterBodyValidator,
  registerOutputValidator,
  AUTH_REGISTER_MESSAGES,
  authRegisterCommand
};
