import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createService as createAccountPreferencesService } from "./accountPreferencesService.js";
import { accountPreferencesActions } from "./accountPreferencesActions.js";
import { deepFreeze } from "../common/support/deepFreeze.js";
import { ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS } from "../common/support/realtimeServiceEvents.js";

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
      events: deepFreeze({
        updatePreferences: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS
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
