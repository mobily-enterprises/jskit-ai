import { createService as createAuthProfileSyncService } from "./common/services/authProfileSyncService.js";
import { resolveProfileSyncLifecycleContributors } from "./profileSyncLifecycleContributorRegistry.js";

function registerUsersCore(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerUsersCore requires application singleton().");
  }

  app.singleton("users.profile.sync.service", (scope) => {
    return createAuthProfileSyncService({
      userProfilesRepository: scope.make("internal.repository.user-profiles"),
      userSettingsRepository: scope.make("internal.repository.user-settings"),
      lifecycleContributors: resolveProfileSyncLifecycleContributors(scope)
    });
  });
}

export { registerUsersCore };
