import { createService as createConsoleService } from "./consoleSettings/consoleService.js";
import { createRepository as createConsoleSettingsRepository } from "./consoleSettings/consoleSettingsRepository.js";
import { createService as createConsoleSettingsService } from "./consoleSettings/consoleSettingsService.js";

// The `console.core` capability: the console settings repository, the
// console access service and the console settings service.
/** @param {{ database: import("@jskit-ai/database-runtime/server/types").RuntimeDatabase }} dependencies */
function createConsoleRuntime({ database }) {
  const consoleSettingsRepository = createConsoleSettingsRepository(database.knex);
  const consoleService = createConsoleService({ consoleSettingsRepository });
  const consoleSettingsService = createConsoleSettingsService({
    consoleService,
    consoleSettingsRepository
  });

  return Object.freeze({
    repositories: Object.freeze({ settings: consoleSettingsRepository }),
    services: Object.freeze({
      access: consoleService,
      settings: consoleSettingsService
    })
  });
}

export { createConsoleRuntime };
