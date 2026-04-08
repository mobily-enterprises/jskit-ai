import { createRepository as createUsersRepository } from "./repositories/usersRepository.js";
import { createRepository as createUserSettingsRepository } from "./repositories/userSettingsRepository.js";
import { createRepository as createConsoleSettingsRepository } from "../consoleSettings/consoleSettingsRepository.js";

function registerCommonRepositories(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerCommonRepositories requires application singleton().");
  }

  app.singleton("usersRepository", (scope) => {
    const knex = scope.make("jskit.database.knex");
    return createUsersRepository(knex);
  });

  app.singleton("userSettingsRepository", (scope) => {
    const knex = scope.make("jskit.database.knex");
    return createUserSettingsRepository(knex);
  });
  app.singleton("consoleSettingsRepository", (scope) => {
    const knex = scope.make("jskit.database.knex");
    return createConsoleSettingsRepository(knex);
  });
}

export { registerCommonRepositories };
