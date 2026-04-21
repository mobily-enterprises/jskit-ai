import { registerBootstrapPayloadContributor } from "@jskit-ai/kernel/server/runtime";
import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { createUsersBootstrapContributor } from "./usersBootstrapContributor.js";

function registerUsersBootstrap(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerUsersBootstrap requires application singleton().");
  }

  registerBootstrapPayloadContributor(app, "users.core.bootstrap.payloadContributor", (scope) => {
    return createUsersBootstrapContributor({
      userProfilesRepository: scope.make("internal.repository.user-profiles"),
      userSettingsRepository: scope.make("internal.repository.user-settings"),
      appConfig: resolveAppConfig(scope),
      authService: scope.make("authService")
    });
  });
}

export { registerUsersBootstrap };
