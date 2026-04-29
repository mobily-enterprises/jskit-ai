import {
  resolveRequest
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";
import { resolveActionUser } from "../common/support/resolveActionUser.js";

const accountNotificationsActions = Object.freeze([
  {
    id: "settings.notifications.update",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    permission: {
      require: "authenticated"
    },
    input: {
      payload: userSettingsResource.operations.notificationsUpdate.body
    },
    output: userSettingsResource.operations.view.output,
    idempotency: "optional",
    audit: {
      actionName: "settings.notifications.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountNotificationsService.updateNotifications(
        resolveRequest(context),
        resolveActionUser(context, input),
        input.payload,
        {
          context
        }
      );
    }
  }
]);

export { accountNotificationsActions };
