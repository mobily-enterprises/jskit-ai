import { createRepository as createUsersRepository } from "./repositories/usersRepository.js";
import { createRepository as createUserSettingsRepository } from "./repositories/userSettingsRepository.js";

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
}

export { registerCommonRepositories };
