import { registerBootstrapPayloadContributor } from "@jskit-ai/kernel/server/runtime";
import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { createUsersBootstrapContributor } from "./usersBootstrapContributor.js";

function registerUsersBootstrap(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerUsersBootstrap requires application singleton().");
  }

  registerBootstrapPayloadContributor(app, "users.core.bootstrap.payloadContributor", (scope) => {
    return createUsersBootstrapContributor({
      usersRepository: scope.make("usersRepository"),
      userSettingsRepository: scope.make("userSettingsRepository"),
      appConfig: resolveAppConfig(scope),
      authService: scope.make("authService")
    });
  });
}

export { registerUsersBootstrap };
