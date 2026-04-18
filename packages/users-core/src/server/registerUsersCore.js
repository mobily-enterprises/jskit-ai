import { createService as createAuthProfileSyncService } from "./common/services/authProfileSyncService.js";
import { resolveProfileSyncLifecycleContributors } from "./profileSyncLifecycleContributorRegistry.js";

function registerUsersCore(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerUsersCore requires application singleton().");
  }

  app.singleton("users.profile.sync.service", (scope) => {
    return createAuthProfileSyncService({
      usersRepository: scope.make("usersRepository"),
      userSettingsRepository: scope.make("userSettingsRepository"),
      lifecycleContributors: resolveProfileSyncLifecycleContributors(scope)
    });
  });
}

export { registerUsersCore };
