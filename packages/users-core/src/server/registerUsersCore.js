import { resolveAppConfig } from "@jskit-ai/kernel/server/support";
import { resolveTenancyProfile } from "../shared/tenancyProfile.js";
import { createService as createAuthProfileSyncService } from "./common/services/authProfileSyncService.js";
import { registerUsersCoreActionSurfaceSources } from "./support/workspaceActionSurfaces.js";

function registerUsersCore(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerUsersCore requires application singleton().");
  }

  registerUsersCoreActionSurfaceSources(app);

  app.singleton("users.profile.sync.service", (scope) => {
    return createAuthProfileSyncService({
      usersRepository: scope.make("usersRepository"),
      userSettingsRepository: scope.make("userSettingsRepository"),
      workspaceProvisioningService:
        typeof scope.has === "function" && scope.has("users.workspace.service")
          ? scope.make("users.workspace.service")
          : null
    });
  });

  app.singleton("users.tenancy.profile", (scope) => {
    const appConfig = resolveAppConfig(scope);
    return resolveTenancyProfile(appConfig);
  });
}

export { registerUsersCore };
