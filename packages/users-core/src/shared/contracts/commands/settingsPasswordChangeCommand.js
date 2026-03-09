import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";

const settingsPasswordChangeInputSchema = Type.Object(
  {
    currentPassword: Type.Optional(Type.String({ minLength: 1 })),
    newPassword: Type.String({ minLength: 8 }),
    confirmPassword: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
);

const settingsPasswordChangeOutputSchema = Type.Object(
  {
    ok: Type.Boolean(),
    message: Type.String()
  },
  { additionalProperties: false }
);

const settingsPasswordChangeCommand = Object.freeze({
  command: "settings.security.password.change",
  operation: Object.freeze({
    method: "POST",
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
  settingsPasswordChangeCommand
};
