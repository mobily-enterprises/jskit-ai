import { createService as createAuthProfileSyncService } from "./common/services/authProfileSyncService.js";
import { resolveProfileSyncLifecycleContributors } from "./profileSyncLifecycleContributorRegistry.js";

function registerUsersCore(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.has !== "function") {
    throw new Error("registerUsersCore requires application singleton()/has().");
  }

  app.singleton("users.profile.sync.service", (scope) => {
    return createAuthProfileSyncService({
      userProfilesRepository: scope.make("internal.repository.user-profiles"),
      userSettingsRepository: scope.make("internal.repository.user-settings"),
      lifecycleContributors: resolveProfileSyncLifecycleContributors(scope)
    });
  });

  if (!app.has("auth.profile.projector")) {
    app.singleton("auth.profile.projector", (scope) => scope.make("users.profile.sync.service"));
  }
}

export { registerUsersCore };
