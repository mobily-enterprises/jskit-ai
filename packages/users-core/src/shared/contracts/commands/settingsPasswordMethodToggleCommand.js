import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";

const settingsPasswordMethodToggleInputSchema = Type.Object(
  {
    enabled: Type.Boolean()
  },
  { additionalProperties: false }
);

const settingsPasswordMethodToggleOutputSchema = Type.Object({}, { additionalProperties: true });

const settingsPasswordMethodToggleCommand = Object.freeze({
  command: "settings.security.password_method.toggle",
  operation: Object.freeze({
    method: "PATCH",
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
  settingsPasswordMethodToggleCommand
};
