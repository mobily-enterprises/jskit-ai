import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { CONSOLE_SETTINGS_CHANGED_EVENT } from "../../shared/events/usersEvents.js";
import { createService as createConsoleSettingsService } from "./consoleSettingsService.js";
import { createService as createConsoleService } from "./consoleService.js";
import { consoleSettingsActions } from "./consoleSettingsActions.js";

function registerConsoleSettings(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
    throw new Error("registerConsoleSettings requires application singleton()/service()/actions().");
  }

  const hasConsoleService = typeof app.has === "function" ? app.has("consoleService") : false;
  if (!hasConsoleService) {
    app.singleton("consoleService", (scope) =>
      createConsoleService({
        consoleSettingsRepository: scope.make("consoleSettingsRepository")
      })
    );
  }

  app.service(
    "users.console.settings.service",
    (scope) =>
      createConsoleSettingsService({
        consoleSettingsRepository: scope.make("consoleSettingsRepository"),
        consoleService: scope.make("consoleService")
      }),
    {
      events: Object.freeze({
        updateSettings: Object.freeze([
          Object.freeze({
            type: "entity.changed",
            source: "console",
            entity: "settings",
            operation: "updated",
            entityId: 1,
            realtime: Object.freeze({
              event: CONSOLE_SETTINGS_CHANGED_EVENT,
              audience: "all_users"
            })
          })
        ])
      })
    }
  );

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
