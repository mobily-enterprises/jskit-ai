import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createService as createAccountNotificationsService } from "./accountNotificationsService.js";
import { accountNotificationsActions } from "./accountNotificationsActions.js";
import { deepFreeze } from "../common/support/deepFreeze.js";
import { ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS } from "../common/support/realtimeServiceEvents.js";

function registerAccountNotifications(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
    throw new Error("registerAccountNotifications requires application singleton()/service()/actions().");
  }

  app.service(
    "users.accountNotifications.service",
    (scope) =>
      createAccountNotificationsService({
        userSettingsRepository: scope.make("internal.repository.user-settings"),
        userProfilesRepository: scope.make("internal.repository.user-profiles"),
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
        accountNotificationsService: "users.accountNotifications.service"
      }
    })
  );
}

export { registerAccountNotifications };
