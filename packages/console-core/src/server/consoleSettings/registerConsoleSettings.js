import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
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
    "console.settings.service",
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
              event: "console.settings.changed",
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
        consoleSettingsService: "console.settings.service"
      }
    })
  );
}

export { registerConsoleSettings };
