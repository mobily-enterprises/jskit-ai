import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createService as createAccountPreferencesService } from "./accountPreferencesService.js";
import { accountPreferencesActions } from "./accountPreferencesActions.js";

const USERS_ACCOUNT_PREFERENCES_ACTION_DEFINITIONS_TOKEN = "users.core.accountPreferences.actionDefinitions";
const USERS_ACCOUNT_PREFERENCES_SERVICE_TOKEN = "users.accountPreferences.service";

function registerAccountPreferences(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerAccountPreferences requires application singleton().");
  }

  app.singleton(USERS_ACCOUNT_PREFERENCES_SERVICE_TOKEN, (scope) => {
    const authService = scope.has("authService") ? scope.make("authService") : null;
    return createAccountPreferencesService({
      userSettingsRepository: scope.make("userSettingsRepository"),
      userProfilesRepository: scope.make("userProfilesRepository"),
      authService
    });
  });

  registerActionDefinitions(app, USERS_ACCOUNT_PREFERENCES_ACTION_DEFINITIONS_TOKEN, {
    contributorId: "users.account-preferences",
    domain: "settings",
    dependencies: {
      accountPreferencesService: USERS_ACCOUNT_PREFERENCES_SERVICE_TOKEN
    },
    actions: accountPreferencesActions
  });
}

export { registerAccountPreferences };
