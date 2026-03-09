import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";

const settingsAvatarUploadInputSchema = Type.Object(
  {
    mimeType: Type.Optional(Type.String({ minLength: 1 })),
    fileName: Type.Optional(Type.String({ minLength: 1 })),
    uploadDimension: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
);

const settingsAvatarUploadOutputSchema = Type.Object({}, { additionalProperties: true });

const settingsAvatarUploadCommand = Object.freeze({
  command: "settings.profile.avatar.upload",
  operation: Object.freeze({
    method: "POST",
    body: Object.freeze({
      schema: settingsAvatarUploadInputSchema,
      normalize: normalizeObjectInput
    }),
    response: Object.freeze({
      schema: settingsAvatarUploadOutputSchema
    }),
    idempotent: false,
    invalidates: Object.freeze(["settings.read"])
  })
});

export {
  settingsAvatarUploadInputSchema,
  settingsAvatarUploadOutputSchema,
  settingsAvatarUploadCommand
};
