import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createService as createAccountNotificationsService } from "./accountNotificationsService.js";
import { accountNotificationsActions } from "./accountNotificationsActions.js";
import { deepFreeze } from "../common/support/deepFreeze.js";
import { ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS } from "../common/support/realtimeServiceEvents.js";

const USERS_ACCOUNT_NOTIFICATIONS_SERVICE_TOKEN = "users.accountNotifications.service";

function registerAccountNotifications(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
    throw new Error("registerAccountNotifications requires application singleton()/service()/actions().");
  }

  app.service(
    USERS_ACCOUNT_NOTIFICATIONS_SERVICE_TOKEN,
    (scope) =>
      createAccountNotificationsService({
        userSettingsRepository: scope.make("userSettingsRepository"),
        userProfilesRepository: scope.make("userProfilesRepository"),
        authService: scope.make("authService")
      }),
    {
      events: deepFreeze({
        updateNotifications: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS
      })
    }
  );

  app.actions(
    withActionDefaults(accountNotificationsActions, {
      domain: "settings",
      dependencies: {
        accountNotificationsService: USERS_ACCOUNT_NOTIFICATIONS_SERVICE_TOKEN
      }
    })
  );
}

export { registerAccountNotifications };
