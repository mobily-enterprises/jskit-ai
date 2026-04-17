import { createRepository as createConsoleSettingsRepository } from "./consoleSettings/consoleSettingsRepository.js";
import { registerConsoleCoreActionSurfaceSources } from "./support/consoleActionSurfaces.js";

function registerConsoleCore(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerConsoleCore requires application singleton().");
  }

  registerConsoleCoreActionSurfaceSources(app);

  app.singleton("consoleSettingsRepository", (scope) => {
    const knex = scope.make("jskit.database.knex");
    return createConsoleSettingsRepository(knex);
  });
}

export { registerConsoleCore };
