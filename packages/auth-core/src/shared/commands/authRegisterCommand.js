import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authEmailFieldDefinition,
  authPasswordFieldDefinition,
  AUTH_FIELD_MESSAGES,
  createCommandMessages,
  registerOutputValidator
} from "./authCommandValidators.js";

const AUTH_REGISTER_MESSAGES = createCommandMessages({
  fields: {
    email: {
      required: AUTH_FIELD_MESSAGES.emailRequired,
      minLength: AUTH_FIELD_MESSAGES.emailRequired,
      pattern: AUTH_FIELD_MESSAGES.emailAddressInvalid,
      default: AUTH_FIELD_MESSAGES.emailAddressInvalid
    },
    password: {
      required: AUTH_FIELD_MESSAGES.passwordRequired,
      minLength: AUTH_FIELD_MESSAGES.passwordMinLength,
      default: AUTH_FIELD_MESSAGES.passwordMinLength
    },
    setupCode: {
      default: AUTH_FIELD_MESSAGES.setupCodeInvalid
    }
  }
});

const authRegisterBodyValidator = deepFreeze({
  schema: createSchema({
    email: { ...authEmailFieldDefinition, required: true },
    password: { ...authPasswordFieldDefinition, required: true },
    invitation: {
      type: "object",
      required: false,
      schema: createSchema({
        token: { type: "string", required: true, minLength: 1, maxLength: 2048 },
        source: { type: "string", required: false, minLength: 1, maxLength: 120 }
      })
    },
    // The first account's one-time setup code, which a production server
    // without accounts asks for (capability features.firstAccountSetupCode).
    setupCode: { type: "string", required: false, minLength: 1, maxLength: 64 }
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
