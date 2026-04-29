import { INTERNAL_JSON_REST_API } from "./jsonRestApiHost.js";
import { createRepository as createUserProfilesRepository } from "./repositories/userProfilesRepository.js";
import { createRepository as createUserSettingsRepository } from "./repositories/userSettingsRepository.js";

function registerCommonRepositories(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerCommonRepositories requires application singleton().");
  }

  app.singleton("internal.repository.user-settings", (scope) => {
    const api = scope.make(INTERNAL_JSON_REST_API);
    const knex = scope.make("jskit.database.knex");
    return createUserSettingsRepository({ api, knex });
  });

  app.singleton("internal.repository.user-profiles", (scope) => {
    const api = scope.make(INTERNAL_JSON_REST_API);
    const knex = scope.make("jskit.database.knex");
    return createUserProfilesRepository({ api, knex });
  });
}

export { registerCommonRepositories };
