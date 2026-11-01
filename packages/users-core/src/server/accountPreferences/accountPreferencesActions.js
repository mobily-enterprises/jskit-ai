import {
  resolveRequest
} from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";
import { ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS } from "../common/support/realtimeServiceEvents.js";

/** @param {{ accountPreferencesService: import("../types.js").AccountPreferencesService }} dependencies */
function createAccountPreferencesActions({ accountPreferencesService }) {
  return Object.freeze([
    Object.freeze({
      id: "settings.preferences.update",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["*"],
      permission: {
        require: "authenticated"
      },
      input: userSettingsResource.operations.preferencesUpdate.body,
      output: null,
      extensions: {
        assistant: {
          description: "Update the signed-in user’s display and regional preferences.",
          output: userSettingsResource.operations.preferencesUpdate.output,
          transformResult: (result) => result.value
        }
      },
      events: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS,
      execute: (input, context) => accountPreferencesService.updatePreferences(
        resolveRequest(context),
        resolveActionUser(context, input),
        input
      )
    })
  ]);
}

export { createAccountPreferencesActions };
