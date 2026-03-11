import { Type } from "typebox";
import { createOperationMessages } from "../contractUtils.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function normalizeSettingsOAuthUnlinkInput(input = {}) {
  const source = normalizeObjectInput(input);

  if (!Object.hasOwn(source, "provider")) {
    return {};
  }

  return {
    provider: normalizeText(source.provider)
  };
}

const settingsOAuthUnlinkInputSchema = Type.Object(
  {
    provider: Type.String({
      minLength: 2,
      maxLength: 64,
      messages: {
        required: "OAuth provider is required.",
        default: "OAuth provider is invalid."
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

const settingsOAuthUnlinkOutputSchema = Type.Object({}, { additionalProperties: true });

const SETTINGS_OAUTH_UNLINK_MESSAGES = createOperationMessages();

const settingsOAuthUnlinkCommand = Object.freeze({
  command: "settings.security.oauth.unlink",
  operation: Object.freeze({
    method: "DELETE",
    messages: SETTINGS_OAUTH_UNLINK_MESSAGES,
    params: Object.freeze({
      schema: settingsOAuthUnlinkInputSchema,
      normalize: normalizeSettingsOAuthUnlinkInput
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
  normalizeSettingsOAuthUnlinkInput,
  settingsOAuthUnlinkOutputSchema,
  SETTINGS_OAUTH_UNLINK_MESSAGES,
  settingsOAuthUnlinkCommand
};
