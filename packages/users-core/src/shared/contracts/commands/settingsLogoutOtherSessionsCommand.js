import { Type } from "typebox";
import {
  createOperationMessages,
  normalizeObjectInput
} from "../contractUtils.js";

const settingsLogoutOtherSessionsInputSchema = Type.Object({}, { additionalProperties: false });
const settingsLogoutOtherSessionsOutputSchema = Type.Object({}, { additionalProperties: true });
const SETTINGS_LOGOUT_OTHER_SESSIONS_MESSAGES = createOperationMessages();

const settingsLogoutOtherSessionsCommand = Object.freeze({
  command: "settings.security.sessions.logout_others",
  operation: Object.freeze({
    method: "POST",
    messages: SETTINGS_LOGOUT_OTHER_SESSIONS_MESSAGES,
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
  SETTINGS_LOGOUT_OTHER_SESSIONS_MESSAGES,
  settingsLogoutOtherSessionsCommand
};
