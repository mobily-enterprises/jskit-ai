import { createSchema } from "json-rest-schema";
import { recordIdSchema } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authEmailValidator,
  AUTH_FIELD_MESSAGES,
  createCommandMessages,
  devLoginAsOutputValidator
} from "./authCommandValidators.js";

const AUTH_DEV_LOGIN_AS_MESSAGES = createCommandMessages({
  fields: {
    userId: {
      pattern: AUTH_FIELD_MESSAGES.devUserIdInvalid,
      default: AUTH_FIELD_MESSAGES.devUserIdInvalid
    },
    email: {
      pattern: AUTH_FIELD_MESSAGES.emailAddressInvalid,
      default: AUTH_FIELD_MESSAGES.emailAddressInvalid
    }
  },
  defaultMessage: AUTH_FIELD_MESSAGES.devUserInvalid
});

const authDevLoginAsBodyValidator = deepFreeze({
  schema: createSchema({
    userId: {
      ...recordIdSchema,
      required: false
    },
    email: {
      ...authEmailValidator,
      required: false
    }
  }),
  mode: "create",
  messages: {
    ...AUTH_DEV_LOGIN_AS_MESSAGES,
    keywords: {
      ...AUTH_DEV_LOGIN_AS_MESSAGES.keywords,
      anyOf: AUTH_FIELD_MESSAGES.devUserRequired
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
