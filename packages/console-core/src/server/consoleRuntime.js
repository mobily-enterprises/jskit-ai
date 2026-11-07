import { createService as createConsoleService } from "./consoleSettings/consoleService.js";
import { createService as createConsoleSettingsService } from "./consoleSettings/consoleSettingsService.js";

/**
 * The `console.core` capability: the console access service and the console
 * settings service, over the `console.settings` record.
 * @param {{ consoleSettingsRepository: import("./types.js").ConsoleSettings }} dependencies
 */
function createConsoleRuntime({ consoleSettingsRepository }) {
  const consoleService = createConsoleService({ consoleSettingsRepository });
  const consoleSettingsService = createConsoleSettingsService({
    consoleService,
    consoleSettingsRepository
  });

  return Object.freeze({
    services: Object.freeze({
      access: consoleService,
      settings: consoleSettingsService
    })
  });
}

export { createConsoleRuntime };
