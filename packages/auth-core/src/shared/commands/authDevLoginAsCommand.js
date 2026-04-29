import { createSchema } from "json-rest-schema";
import { recordIdInputSchema } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authEmailValidator,
  createCommandMessages,
  devLoginAsOutputValidator
} from "./authCommandValidators.js";

const AUTH_DEV_LOGIN_AS_MESSAGES = createCommandMessages({
  fields: {
    userId: {
      pattern: "Provide a valid user id.",
      default: "Provide a valid user id."
    },
    email: {
      pattern: "Enter a valid email address.",
      default: "Enter a valid email address."
    }
  },
  defaultMessage: "Provide a valid user id or email."
});

const authDevLoginAsBodyValidator = deepFreeze({
  schema: createSchema({
    userId: {
      ...recordIdInputSchema,
      required: false
    },
    email: {
      ...authEmailValidator,
      required: false
    }
  }),
  mode: "patch",
  messages: {
    ...AUTH_DEV_LOGIN_AS_MESSAGES,
    keywords: {
      ...AUTH_DEV_LOGIN_AS_MESSAGES.keywords,
      anyOf: "Provide a user id or email."
    }
  }
});

const authDevLoginAsCommand = deepFreeze({
  command: "auth.dev.loginAs",
  operation: {
    method: "POST",
    body: authDevLoginAsBodyValidator,
    response: devLoginAsOutputValidator,
    messages: AUTH_DEV_LOGIN_AS_MESSAGES,
    idempotent: false,
    invalidates: ["auth.session.read"]
  }
});

export { AUTH_DEV_LOGIN_AS_MESSAGES, authDevLoginAsBodyValidator, authDevLoginAsCommand };
