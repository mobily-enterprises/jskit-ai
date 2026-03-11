import { Type } from "typebox";
import { createOperationMessages } from "./contractUtils.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";

const settingsAvatarUploadInputSchema = Type.Object(
  {
    mimeType: Type.Optional(
      Type.String({
        minLength: 1,
        messages: {
          default: "Avatar mimeType is invalid."
        }
      })
    ),
    fileName: Type.Optional(
      Type.String({
        minLength: 1,
        messages: {
          default: "Avatar fileName is invalid."
        }
      })
    ),
    uploadDimension: Type.Optional(
      Type.String({
        minLength: 1,
        messages: {
          default: "Avatar uploadDimension is invalid."
        }
      })
    )
  },
  { additionalProperties: true }
);

const settingsAvatarUploadOutputSchema = Type.Object({}, { additionalProperties: true });

const SETTINGS_AVATAR_UPLOAD_MESSAGES = createOperationMessages();

const settingsAvatarUploadCommand = Object.freeze({
  command: "settings.profile.avatar.upload",
  operation: Object.freeze({
    method: "POST",
    messages: SETTINGS_AVATAR_UPLOAD_MESSAGES,
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
  SETTINGS_AVATAR_UPLOAD_MESSAGES,
  settingsAvatarUploadCommand
};
