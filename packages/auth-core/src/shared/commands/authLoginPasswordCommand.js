import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authEmailFieldDefinition,
  authLoginPasswordFieldDefinition,
  AUTH_FIELD_MESSAGES,
  createCommandMessages,
  loginOutputValidator
} from "./authCommandValidators.js";

const AUTH_LOGIN_PASSWORD_MESSAGES = createCommandMessages({
  fields: {
    email: {
      required: AUTH_FIELD_MESSAGES.emailRequired,
      minLength: AUTH_FIELD_MESSAGES.emailRequired,
      pattern: AUTH_FIELD_MESSAGES.emailAddressInvalid,
      default: AUTH_FIELD_MESSAGES.emailAddressInvalid
    },
    password: {
      required: AUTH_FIELD_MESSAGES.passwordRequired,
      minLength: AUTH_FIELD_MESSAGES.passwordRequired,
      default: AUTH_FIELD_MESSAGES.passwordRequired
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
    response: loginOutputValidator,
    messages: AUTH_LOGIN_PASSWORD_MESSAGES,
    idempotent: false,
    invalidates: ["auth.session.read"]
  }
});

export {
  authLoginPasswordBodyValidator,
  loginOutputValidator,
  AUTH_LOGIN_PASSWORD_MESSAGES,
  authLoginPasswordCommand
};
