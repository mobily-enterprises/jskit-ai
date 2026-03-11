import { Type } from "typebox";
import { createOperationMessages } from "./contractUtils.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";

const settingsAvatarDeleteInputSchema = Type.Object({}, { additionalProperties: false });
const settingsAvatarDeleteOutputSchema = Type.Object({}, { additionalProperties: true });
const SETTINGS_AVATAR_DELETE_MESSAGES = createOperationMessages();

const settingsAvatarDeleteCommand = Object.freeze({
  command: "settings.profile.avatar.delete",
  operation: Object.freeze({
    method: "DELETE",
    messages: SETTINGS_AVATAR_DELETE_MESSAGES,
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
  SETTINGS_AVATAR_DELETE_MESSAGES,
  settingsAvatarDeleteCommand
};
