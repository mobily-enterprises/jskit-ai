import { Type } from "typebox";
import { createOperationMessages } from "./contractUtils.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";

const settingsPasswordChangeInputSchema = Type.Object(
  {
    currentPassword: Type.Optional(
      Type.String({
        minLength: 1,
        messages: {
          default: "Current password is invalid."
        }
      })
    ),
    newPassword: Type.String({
      minLength: 8,
      messages: {
        required: "New password is required.",
        minLength: "New password must be at least 8 characters.",
        default: "New password must be at least 8 characters."
      }
    }),
    confirmPassword: Type.String({
      minLength: 1,
      messages: {
        required: "Confirm password is required.",
        minLength: "Confirm password is required.",
        default: "Confirm password is required."
      }
    })
  },
  {
    additionalProperties: false,
    messages: {
      additionalProperties: "Unexpected field."
    }
  }
);

const settingsPasswordChangeOutputSchema = Type.Object(
  {
    ok: Type.Boolean(),
    message: Type.String()
  },
  { additionalProperties: false }
);

const SETTINGS_PASSWORD_CHANGE_MESSAGES = createOperationMessages();

const settingsPasswordChangeCommand = Object.freeze({
  command: "settings.security.password.change",
  operation: Object.freeze({
    method: "POST",
    messages: SETTINGS_PASSWORD_CHANGE_MESSAGES,
    body: Object.freeze({
      schema: settingsPasswordChangeInputSchema,
      normalize: normalizeObjectInput
    }),
    response: Object.freeze({
      schema: settingsPasswordChangeOutputSchema
    }),
    idempotent: false,
    invalidates: Object.freeze(["settings.read"])
  })
});

export {
  settingsPasswordChangeInputSchema,
  settingsPasswordChangeOutputSchema,
  SETTINGS_PASSWORD_CHANGE_MESSAGES,
  settingsPasswordChangeCommand
};
