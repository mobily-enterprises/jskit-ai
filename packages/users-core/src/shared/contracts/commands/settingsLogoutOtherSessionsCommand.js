import { Type } from "typebox";
import { normalizeObjectInput } from "../contractUtils.js";

const settingsLogoutOtherSessionsInputSchema = Type.Object({}, { additionalProperties: false });
const settingsLogoutOtherSessionsOutputSchema = Type.Object({}, { additionalProperties: true });

const settingsLogoutOtherSessionsCommand = Object.freeze({
  command: "settings.security.sessions.logout_others",
  operation: Object.freeze({
    method: "POST",
    body: Object.freeze({
      schema: settingsLogoutOtherSessionsInputSchema,
      normalize: normalizeObjectInput
    }),
    response: Object.freeze({
      schema: settingsLogoutOtherSessionsOutputSchema
    }),
    idempotent: false,
    invalidates: Object.freeze([])
  })
});

export {
  settingsLogoutOtherSessionsInputSchema,
  settingsLogoutOtherSessionsOutputSchema,
  settingsLogoutOtherSessionsCommand
};
