import { createService as createAccountPreferencesService } from "./accountPreferencesService.js";
import { accountPreferencesActions } from "./accountPreferencesActions.js";

const USERS_ACCOUNT_PREFERENCES_SERVICE_TOKEN = "users.accountPreferences.service";

function registerAccountPreferences(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.actions !== "function") {
    throw new Error("registerAccountPreferences requires application singleton()/actions().");
  }

  app.singleton(USERS_ACCOUNT_PREFERENCES_SERVICE_TOKEN, (scope) => {
    return createAccountPreferencesService({
      userSettingsRepository: scope.make("userSettingsRepository"),
      userProfilesRepository: scope.make("userProfilesRepository"),
      authService: scope.make("authService")
    });
  });

  app.actions({
    contributorId: "users.account-preferences",
    domain: "settings",
    dependencies: {
      accountPreferencesService: USERS_ACCOUNT_PREFERENCES_SERVICE_TOKEN
    },
    actions: accountPreferencesActions
  });
}

export { registerAccountPreferences };
