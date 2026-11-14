import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  authEmailFieldDefinition,
  authLoginPasswordFieldDefinition,
  authRecoveryTokenValidator,
  AUTH_FIELD_MESSAGES,
  createCommandMessages
} from "./authCommandValidators.js";

// An account's email change: the signed-in person asks for a new address with their password, and the link sent to
// that address confirms it.
const AUTH_EMAIL_CHANGE_REQUEST_MESSAGES = createCommandMessages({
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

const AUTH_EMAIL_CHANGE_CONFIRM_MESSAGES = createCommandMessages({
  fields: {
    token: {
      required: AUTH_FIELD_MESSAGES.confirmationCodeRequired,
      minLength: AUTH_FIELD_MESSAGES.confirmationCodeRequired,
      default: AUTH_FIELD_MESSAGES.confirmationCodeRequired
    }
  }
});

// The address the link went to, or the email the account now has.
const emailChangeOutputValidator = deepFreeze({
  schema: createSchema({
    ok: { type: "boolean", required: true },
    email: { ...authEmailFieldDefinition, required: true }
  }),
  mode: "replace"
});

const authEmailChangeRequestCommand = deepFreeze({
  command: "auth.emailChange.request",
  operation: {
    method: "POST",
    body: deepFreeze({
      schema: createSchema({
        email: { ...authEmailFieldDefinition, required: true },
        password: { ...authLoginPasswordFieldDefinition, required: true }
      }),
      mode: "create",
      messages: AUTH_EMAIL_CHANGE_REQUEST_MESSAGES
    }),
    response: emailChangeOutputValidator,
    messages: AUTH_EMAIL_CHANGE_REQUEST_MESSAGES,
    idempotent: false,
    invalidates: []
  }
});

const authEmailChangeConfirmCommand = deepFreeze({
  command: "auth.emailChange.confirm",
  operation: {
    method: "POST",
    body: deepFreeze({
      schema: createSchema({
        token: { ...authRecoveryTokenValidator, required: true }
      }),
      mode: "create",
      messages: AUTH_EMAIL_CHANGE_CONFIRM_MESSAGES
    }),
    response: emailChangeOutputValidator,
    messages: AUTH_EMAIL_CHANGE_CONFIRM_MESSAGES,
    idempotent: false,
    invalidates: ["auth.session.read"]
  }
});

export { authEmailChangeConfirmCommand, authEmailChangeRequestCommand };
