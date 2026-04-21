import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createService as createAccountPreferencesService } from "./accountPreferencesService.js";
import { accountPreferencesActions } from "./accountPreferencesActions.js";
import { deepFreeze } from "../common/support/deepFreeze.js";
import { ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS } from "../common/support/realtimeServiceEvents.js";

function registerAccountPreferences(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
    throw new Error("registerAccountPreferences requires application singleton()/service()/actions().");
  }

  app.service(
    "users.accountPreferences.service",
    (scope) =>
      createAccountPreferencesService({
        userSettingsRepository: scope.make("internal.repository.user-settings"),
        userProfilesRepository: scope.make("internal.repository.user-profiles"),
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
        accountPreferencesService: "users.accountPreferences.service"
      }
    })
  );
}

export { registerAccountPreferences };
