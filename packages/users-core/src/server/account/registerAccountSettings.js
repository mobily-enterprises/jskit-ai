import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createService as createSettingsService } from "./accountSettingsService.js";
import { accountPreferencesActions } from "../accountPreferences/accountPreferencesActions.js";
import { accountNotificationsActions } from "../accountNotifications/accountNotificationsActions.js";
import { accountChatActions } from "../accountChat/accountChatActions.js";

const USERS_ACCOUNT_PREFERENCES_ACTION_DEFINITIONS_TOKEN = "users.core.accountPreferences.actionDefinitions";
const USERS_ACCOUNT_NOTIFICATIONS_ACTION_DEFINITIONS_TOKEN = "users.core.accountNotifications.actionDefinitions";
const USERS_ACCOUNT_CHAT_ACTION_DEFINITIONS_TOKEN = "users.core.accountChat.actionDefinitions";

function registerAccountSettings(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerAccountSettings requires application singleton().");
  }

  app.singleton("users.settings.service", (scope) => {
    const authService = scope.has("authService") ? scope.make("authService") : null;
    return createSettingsService({
      userSettingsRepository: scope.make("userSettingsRepository"),
      userProfilesRepository: scope.make("userProfilesRepository"),
      authService
    });
  });

  registerActionDefinitions(app, USERS_ACCOUNT_PREFERENCES_ACTION_DEFINITIONS_TOKEN, {
    contributorId: "users.account-preferences",
    domain: "settings",
    dependencies: {
      settingsService: "users.settings.service"
    },
    actions: accountPreferencesActions
  });

  registerActionDefinitions(app, USERS_ACCOUNT_NOTIFICATIONS_ACTION_DEFINITIONS_TOKEN, {
    contributorId: "users.account-notifications",
    domain: "settings",
    dependencies: {
      settingsService: "users.settings.service"
    },
    actions: accountNotificationsActions
  });

  registerActionDefinitions(app, USERS_ACCOUNT_CHAT_ACTION_DEFINITIONS_TOKEN, {
    contributorId: "users.account-chat",
    domain: "settings",
    dependencies: {
      settingsService: "users.settings.service"
    },
    actions: accountChatActions
  });
}

export { registerAccountSettings };
