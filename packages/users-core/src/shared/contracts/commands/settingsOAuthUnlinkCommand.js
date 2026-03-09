import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";

const settingsOAuthUnlinkInputSchema = Type.Object(
  {
    provider: Type.String({ minLength: 2, maxLength: 64 })
  },
  { additionalProperties: false }
);

const settingsOAuthUnlinkOutputSchema = Type.Object({}, { additionalProperties: true });

const settingsOAuthUnlinkCommand = Object.freeze({
  command: "settings.security.oauth.unlink",
  operation: Object.freeze({
    method: "DELETE",
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
  settingsOAuthUnlinkCommand
};
