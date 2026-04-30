import { registerAuthServiceDecorator } from "@jskit-ai/auth-core/server/authServiceDecoratorRegistry";
import { createConsoleAuthServiceDecorator } from "./consoleAuthServiceDecorator.js";
import { createRepository as createConsoleSettingsRepository } from "./consoleSettings/consoleSettingsRepository.js";
import { registerConsoleCoreActionSurfaceSources } from "./support/consoleActionSurfaces.js";

function registerConsoleCore(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerConsoleCore requires application singleton().");
  }

  registerConsoleCoreActionSurfaceSources(app);

  registerAuthServiceDecorator(app, "console.core.authServiceDecorator", (scope) =>
    createConsoleAuthServiceDecorator({
      consoleService: scope.make("consoleService")
    })
  );

  app.singleton("consoleSettingsRepository", (scope) => {
    const knex = scope.make("jskit.database.knex");
    return createConsoleSettingsRepository(knex);
  });
}

export { registerConsoleCore };
