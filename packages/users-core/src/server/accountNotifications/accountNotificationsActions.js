import {
  requireAuthenticated,
  resolveRequest,
  resolveUser
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { userSettingsResource } from "../../shared/resources/userSettingsResource.js";

const accountNotificationsActions = Object.freeze([
  {
    id: "settings.notifications.update",
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfacesFrom: "enabled",
    consoleUsersOnly: false,
    input: userSettingsResource.operations.notificationsUpdate.body,
    output: userSettingsResource.operations.view.output,
    permission: requireAuthenticated,
    idempotency: "optional",
    audit: {
      actionName: "settings.notifications.update"
    },
    observability: {},
    async execute(input, context, deps) {
      return deps.accountNotificationsService.updateNotifications(
        resolveRequest(context),
        resolveUser(context, input),
        input
      );
    }
  }
]);

export { accountNotificationsActions };
