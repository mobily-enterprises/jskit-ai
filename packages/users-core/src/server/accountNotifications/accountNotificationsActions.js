import {
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";

const accountNotificationsActions = Object.freeze([
  {
    id: "settings.notifications.update",
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    permission: {
      require: "authenticated"
    },
    inputValidator: userSettingsResource.operations.notificationsUpdate.bodyValidator,
    outputValidator: userSettingsResource.operations.view.outputValidator,
    idempotency: "optional",
    audit: {
      actionName: "settings.notifications.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountNotificationsService.updateNotifications(
        resolveRequest(context),
        resolveUser(context, input),
        input,
        {
          context
        }
      );
    }
  }
]);

export { accountNotificationsActions };
