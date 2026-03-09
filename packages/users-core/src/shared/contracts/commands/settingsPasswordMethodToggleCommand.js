import { Type } from "typebox";
import { createOperationMessages } from "../contractUtils.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";

const settingsPasswordMethodToggleInputSchema = Type.Object(
  {
    enabled: Type.Boolean({
      messages: {
        required: "enabled is required.",
        default: "enabled must be a boolean."
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

const settingsPasswordMethodToggleOutputSchema = Type.Object({}, { additionalProperties: true });

const SETTINGS_PASSWORD_METHOD_TOGGLE_MESSAGES = createOperationMessages();

const settingsPasswordMethodToggleCommand = Object.freeze({
  command: "settings.security.password_method.toggle",
  operation: Object.freeze({
    method: "PATCH",
    messages: SETTINGS_PASSWORD_METHOD_TOGGLE_MESSAGES,
    body: Object.freeze({
      schema: settingsPasswordMethodToggleInputSchema,
      normalize: normalizeObjectInput
    }),
    response: Object.freeze({
      schema: settingsPasswordMethodToggleOutputSchema
    }),
    idempotent: false,
    invalidates: Object.freeze(["settings.read"])
  })
});

export {
  settingsPasswordMethodToggleInputSchema,
  settingsPasswordMethodToggleOutputSchema,
  SETTINGS_PASSWORD_METHOD_TOGGLE_MESSAGES,
  settingsPasswordMethodToggleCommand
};
