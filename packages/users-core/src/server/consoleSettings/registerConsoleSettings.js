import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createService as createConsoleSettingsService } from "./consoleSettingsService.js";
import { consoleSettingsActions } from "./consoleSettingsActions.js";

const USERS_CONSOLE_SETTINGS_ACTION_DEFINITIONS_TOKEN = "users.core.console.settings.actionDefinitions";

function registerConsoleSettings(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerConsoleSettings requires application singleton().");
  }

  app.singleton("users.console.settings.service", (scope) => {
    return createConsoleSettingsService({
      consoleSettingsRepository: scope.make("consoleSettingsRepository")
    });
  });

  registerActionDefinitions(app, USERS_CONSOLE_SETTINGS_ACTION_DEFINITIONS_TOKEN, {
    contributorId: "users.console-settings",
    domain: "console",
    dependencies: {
      consoleSettingsService: "users.console.settings.service"
    },
    actions: consoleSettingsActions
  });
}

export { registerConsoleSettings };
