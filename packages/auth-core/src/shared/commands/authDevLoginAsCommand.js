import { Type } from "typebox";
import { recordIdInputSchema } from "@jskit-ai/kernel/shared/validators";
import { normalizeObjectInput } from "../inputNormalization.js";
import {
  authEmailValidator,
  createCommandMessages,
  devLoginAsResponseValidator
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

const authDevLoginAsBodyValidator = Object.freeze({
  schema: Type.Object(
    {
      userId: Type.Optional(recordIdInputSchema),
      email: Type.Optional(authEmailValidator.schema)
    },
    {
      additionalProperties: false,
      anyOf: [{ required: ["userId"] }, { required: ["email"] }]
    }
  ),
  normalize: normalizeObjectInput,
  messages: {
    ...AUTH_DEV_LOGIN_AS_MESSAGES,
    keywords: {
      ...AUTH_DEV_LOGIN_AS_MESSAGES.keywords,
      anyOf: "Provide a user id or email."
    }
  }
});

const authDevLoginAsCommand = Object.freeze({
  command: "auth.dev.loginAs",
  operation: Object.freeze({
    method: "POST",
    bodyValidator: authDevLoginAsBodyValidator,
    responseValidator: devLoginAsResponseValidator,
    messages: AUTH_DEV_LOGIN_AS_MESSAGES,
    idempotent: false,
    invalidates: Object.freeze(["auth.session.read"])
  })
});

export { AUTH_DEV_LOGIN_AS_MESSAGES, authDevLoginAsBodyValidator, authDevLoginAsCommand };
