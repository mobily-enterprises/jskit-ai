import { Type } from "typebox";
import {
  createOperationMessages,
  normalizeObjectInput
} from "../contractUtils.js";

const settingsAvatarUploadInputSchema = Type.Object(
  {
    mimeType: Type.Optional(Type.String({ minLength: 1 })),
    fileName: Type.Optional(Type.String({ minLength: 1 })),
    uploadDimension: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
);

const settingsAvatarUploadOutputSchema = Type.Object({}, { additionalProperties: true });

const SETTINGS_AVATAR_UPLOAD_MESSAGES = createOperationMessages({
  fields: {
    mimeType: {
      default: "Avatar mimeType is invalid."
    },
    fileName: {
      default: "Avatar fileName is invalid."
    },
    uploadDimension: {
      default: "Avatar uploadDimension is invalid."
    }
  }
});

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
