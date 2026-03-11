import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createService as createAccountProfileService } from "./accountProfileService.js";
import { accountProfileActions } from "./accountProfileActions.js";

const USERS_ACCOUNT_PROFILE_ACTION_DEFINITIONS_TOKEN = "users.core.accountProfile.actionDefinitions";
const USERS_ACCOUNT_PROFILE_SERVICE_TOKEN = "users.accountProfile.service";

function registerAccountProfile(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerAccountProfile requires application singleton().");
  }

  app.singleton(USERS_ACCOUNT_PROFILE_SERVICE_TOKEN, (scope) => {
    return createAccountProfileService({
      userSettingsRepository: scope.make("userSettingsRepository"),
      userProfilesRepository: scope.make("userProfilesRepository"),
      authService: scope.make("authService")
    });
  });

  registerActionDefinitions(app, USERS_ACCOUNT_PROFILE_ACTION_DEFINITIONS_TOKEN, {
    contributorId: "users.account-profile",
    domain: "settings",
    dependencies: {
      accountProfileService: USERS_ACCOUNT_PROFILE_SERVICE_TOKEN
    },
    actions: accountProfileActions
  });
}

export { registerAccountProfile };
