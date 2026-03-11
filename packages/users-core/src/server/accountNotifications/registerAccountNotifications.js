import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createService as createAccountNotificationsService } from "./accountNotificationsService.js";
import { accountNotificationsActions } from "./accountNotificationsActions.js";

const USERS_ACCOUNT_NOTIFICATIONS_ACTION_DEFINITIONS_TOKEN = "users.core.accountNotifications.actionDefinitions";
const USERS_ACCOUNT_NOTIFICATIONS_SERVICE_TOKEN = "users.accountNotifications.service";

function registerAccountNotifications(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerAccountNotifications requires application singleton().");
  }

  app.singleton(USERS_ACCOUNT_NOTIFICATIONS_SERVICE_TOKEN, (scope) => {
    return createAccountNotificationsService({
      userSettingsRepository: scope.make("userSettingsRepository"),
      userProfilesRepository: scope.make("userProfilesRepository"),
      authService: scope.make("authService")
    });
  });

  registerActionDefinitions(app, USERS_ACCOUNT_NOTIFICATIONS_ACTION_DEFINITIONS_TOKEN, {
    contributorId: "users.account-notifications",
    domain: "settings",
    dependencies: {
      accountNotificationsService: USERS_ACCOUNT_NOTIFICATIONS_SERVICE_TOKEN
    },
    actions: accountNotificationsActions
  });
}

export { registerAccountNotifications };
