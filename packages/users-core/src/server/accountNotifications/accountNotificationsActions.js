import {
  resolveRequest
} from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";
import { ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS } from "../common/support/realtimeServiceEvents.js";

/** @param {{ accountNotificationsService: import("../types.js").AccountNotificationsService }} dependencies */
function createAccountNotificationsActions({ accountNotificationsService }) {
  return Object.freeze([
    Object.freeze({
      id: "settings.notifications.update",
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: ["*"],
      permission: {
        require: "authenticated"
      },
      input: userSettingsResource.operations.notificationsUpdate.body,
      output: null,
      extensions: {
        assistant: {
          description: "Update the signed-in user’s notification preferences.",
          output: userSettingsResource.operations.notificationsUpdate.output,
          transformResult: (result) => result.value
        }
      },
      idempotency: "optional",
      events: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS,
      execute: (input, context) => accountNotificationsService.updateNotifications(
        resolveRequest(context),
        resolveActionUser(context, input),
        input
      )
    })
  ]);
}

export { createAccountNotificationsActions };
