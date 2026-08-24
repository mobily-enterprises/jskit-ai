import {
  resolveRequest
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";
import { ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS } from "../common/support/realtimeServiceEvents.js";

const accountNotificationsActionSpecifications = Object.freeze([
  {
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
    idempotency: "optional",
    audit: {
      actionName: "settings.notifications.update"
    },
    observability: {},
    events: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS,
    async run(accountNotificationsService, input, context) {
      return accountNotificationsService.updateNotifications(
        resolveRequest(context),
        resolveActionUser(context, input),
        input,
        {
          context
        }
      );
    }
  }
]);

function buildAccountNotificationsActions({ accountNotificationsService } = {}) {
  if (!accountNotificationsService) throw new TypeError("buildAccountNotificationsActions requires accountNotificationsService.");
  return accountNotificationsActionSpecifications.map(({ run, ...definition }) => Object.freeze({
    ...definition,
    execute(input, context) {
      return run(accountNotificationsService, input, context);
    }
  }));
}

export { accountNotificationsActionSpecifications, buildAccountNotificationsActions };
