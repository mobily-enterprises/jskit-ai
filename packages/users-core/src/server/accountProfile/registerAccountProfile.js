import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createService as createAccountProfileService } from "./accountProfileService.js";
import { accountProfileActions } from "./accountProfileActions.js";

const USERS_ACCOUNT_PROFILE_SERVICE_TOKEN = "users.accountProfile.service";

function registerAccountProfile(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.actions !== "function") {
    throw new Error("registerAccountProfile requires application singleton()/actions().");
  }

  app.singleton(USERS_ACCOUNT_PROFILE_SERVICE_TOKEN, (scope) => {
    return createAccountProfileService({
      userSettingsRepository: scope.make("userSettingsRepository"),
      userProfilesRepository: scope.make("userProfilesRepository"),
      authService: scope.make("authService")
    });
  });

  app.actions(
    withActionDefaults(accountProfileActions, {
      domain: "settings",
      dependencies: {
        accountProfileService: USERS_ACCOUNT_PROFILE_SERVICE_TOKEN
      }
    })
  );
}

export { registerAccountProfile };
