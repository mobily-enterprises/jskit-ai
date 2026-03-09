import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";

const settingsAvatarDeleteInputSchema = Type.Object({}, { additionalProperties: false });
const settingsAvatarDeleteOutputSchema = Type.Object({}, { additionalProperties: true });

const settingsAvatarDeleteCommand = Object.freeze({
  command: "settings.profile.avatar.delete",
  operation: Object.freeze({
    method: "DELETE",
    body: Object.freeze({
      schema: settingsAvatarDeleteInputSchema,
      normalize: normalizeObjectInput
    }),
    response: Object.freeze({
      schema: settingsAvatarDeleteOutputSchema
    }),
    idempotent: false,
    invalidates: Object.freeze(["settings.read"])
  })
});

export {
  settingsAvatarDeleteInputSchema,
  settingsAvatarDeleteOutputSchema,
  settingsAvatarDeleteCommand
};
