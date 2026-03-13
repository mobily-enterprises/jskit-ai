import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createService as createConsoleSettingsService } from "./consoleSettingsService.js";
import { consoleSettingsActions } from "./consoleSettingsActions.js";

function registerConsoleSettings(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.actions !== "function") {
    throw new Error("registerConsoleSettings requires application singleton()/actions().");
  }

  app.singleton("users.console.settings.service", (scope) => {
    return createConsoleSettingsService({
      consoleSettingsRepository: scope.make("consoleSettingsRepository")
    });
  });

  app.actions(
    withActionDefaults(consoleSettingsActions, {
      domain: "console",
      dependencies: {
        consoleSettingsService: "users.console.settings.service"
      }
    })
  );
}

export { registerConsoleSettings };
