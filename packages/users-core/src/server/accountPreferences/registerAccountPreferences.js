import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { ACCOUNT_SETTINGS_CHANGED_EVENT } from "../../shared/events/usersEvents.js";
import { createService as createAccountPreferencesService } from "./accountPreferencesService.js";
import { accountPreferencesActions } from "./accountPreferencesActions.js";

const USERS_ACCOUNT_PREFERENCES_SERVICE_TOKEN = "users.accountPreferences.service";

function registerAccountPreferences(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
    throw new Error("registerAccountPreferences requires application singleton()/service()/actions().");
  }

  app.service(
    USERS_ACCOUNT_PREFERENCES_SERVICE_TOKEN,
    (scope) =>
      createAccountPreferencesService({
        userSettingsRepository: scope.make("userSettingsRepository"),
        userProfilesRepository: scope.make("userProfilesRepository"),
        authService: scope.make("authService")
      }),
    {
      events: Object.freeze({
        updatePreferences: Object.freeze([
          Object.freeze({
            type: "entity.changed",
            source: "account",
            entity: "settings",
            operation: "updated",
            entityId: ({ options }) => Number(options?.context?.actor?.id || 0),
            realtime: Object.freeze({
              event: ACCOUNT_SETTINGS_CHANGED_EVENT,
              audience: "actor_user"
            })
          })
        ])
      })
    }
  );

  app.actions(
    withActionDefaults(accountPreferencesActions, {
      domain: "settings",
      dependencies: {
        accountPreferencesService: USERS_ACCOUNT_PREFERENCES_SERVICE_TOKEN
      }
    })
  );
}

export { registerAccountPreferences };
