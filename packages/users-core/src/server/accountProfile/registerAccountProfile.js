import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createService as createAccountProfileService } from "./accountProfileService.js";
import { createService as createAvatarStorageService } from "./avatarStorageService.js";
import { createService as createAvatarService } from "./avatarService.js";
import { accountProfileActions } from "./accountProfileActions.js";
import { deepFreeze } from "../common/support/deepFreeze.js";
import { ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS } from "../common/support/realtimeServiceEvents.js";


function registerAccountProfile(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.service !== "function" || typeof app.actions !== "function") {
    throw new Error("registerAccountProfile requires application singleton()/service()/actions().");
  }

  app.singleton("users.avatar.storage.service", (scope) =>
    createAvatarStorageService({
      storage: scope.make("jskit.storage")
    })
  );

  app.singleton("users.avatar.service", (scope) =>
    createAvatarService({
      userProfilesRepository: scope.make("internal.repository.user-profiles"),
      avatarStorageService: scope.make("users.avatar.storage.service")
    })
  );

  app.service(
    "users.accountProfile.service",
    (scope) =>
      createAccountProfileService({
        userSettingsRepository: scope.make("internal.repository.user-settings"),
        userProfilesRepository: scope.make("internal.repository.user-profiles"),
        authService: scope.make("authService"),
        avatarService: scope.make("users.avatar.service")
      }),
    {
      events: deepFreeze({
        updateProfile: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS,
        uploadAvatar: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS,
        deleteAvatar: ACCOUNT_SETTINGS_AND_BOOTSTRAP_EVENTS
      })
    }
  );

  app.actions(
    withActionDefaults(accountProfileActions, {
      domain: "settings",
      dependencies: {
        accountProfileService: "users.accountProfile.service"
      }
    })
  );
}

export { registerAccountProfile };
