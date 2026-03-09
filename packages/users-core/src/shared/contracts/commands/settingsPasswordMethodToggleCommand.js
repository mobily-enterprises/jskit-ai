import { Type } from "typebox";
import {
  createOperationMessages,
  normalizeObjectInput
} from "../contractUtils.js";

const settingsPasswordMethodToggleInputSchema = Type.Object(
  {
    enabled: Type.Boolean()
  },
  { additionalProperties: false }
);

const settingsPasswordMethodToggleOutputSchema = Type.Object({}, { additionalProperties: true });

const SETTINGS_PASSWORD_METHOD_TOGGLE_MESSAGES = createOperationMessages({
  fields: {
    enabled: {
      required: "enabled is required.",
      default: "enabled must be a boolean."
    }
  }
});

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
