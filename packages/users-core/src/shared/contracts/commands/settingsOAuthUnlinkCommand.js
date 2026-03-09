import { Type } from "typebox";
import {
  createOperationMessages,
  normalizeObjectInput
} from "../contractUtils.js";

const settingsOAuthUnlinkInputSchema = Type.Object(
  {
    provider: Type.String({ minLength: 2, maxLength: 64 })
  },
  { additionalProperties: false }
);

const settingsOAuthUnlinkOutputSchema = Type.Object({}, { additionalProperties: true });

const SETTINGS_OAUTH_UNLINK_MESSAGES = createOperationMessages({
  fields: {
    provider: {
      required: "OAuth provider is required.",
      default: "OAuth provider is invalid."
    }
  }
});

const settingsOAuthUnlinkCommand = Object.freeze({
  command: "settings.security.oauth.unlink",
  operation: Object.freeze({
    method: "DELETE",
    messages: SETTINGS_OAUTH_UNLINK_MESSAGES,
    params: Object.freeze({
      schema: settingsOAuthUnlinkInputSchema,
      normalize: normalizeObjectInput
    }),
    response: Object.freeze({
      schema: settingsOAuthUnlinkOutputSchema
    }),
    idempotent: false,
    invalidates: Object.freeze(["settings.read"])
  })
});

export {
  settingsOAuthUnlinkInputSchema,
  settingsOAuthUnlinkOutputSchema,
  SETTINGS_OAUTH_UNLINK_MESSAGES,
  settingsOAuthUnlinkCommand
};
