import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import {
  ACCOUNT_SETTINGS_CHANGED_EVENT,
  USERS_BOOTSTRAP_CHANGED_EVENT
} from "../../shared/events/usersEvents.js";
import { createService as createAccountNotificationsService } from "./accountNotificationsService.js";
import { accountNotificationsActions } from "./accountNotificationsActions.js";
import { deepFreeze } from "../common/support/deepFreeze.js";

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
        updateNotifications: [
          {
            type: "entity.changed",
            source: "account",
            entity: "settings",
            operation: "updated",
            entityId: ({ options }) => Number(options?.context?.actor?.id || 0),
            realtime: {
              event: ACCOUNT_SETTINGS_CHANGED_EVENT,
              audience: "actor_user"
            }
          },
          {
            type: "entity.changed",
            source: "users",
            entity: "bootstrap",
            operation: "updated",
            entityId: ({ options }) => Number(options?.context?.actor?.id || 0),
            realtime: {
              event: USERS_BOOTSTRAP_CHANGED_EVENT,
              audience: "actor_user"
            }
          }
        ]
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
