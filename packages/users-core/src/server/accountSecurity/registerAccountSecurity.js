import { registerActionDefinitions } from "@jskit-ai/kernel/server/actions";
import { createService as createAccountSecurityService } from "./accountSecurityService.js";
import { accountSecurityActions } from "./accountSecurityActions.js";

const USERS_ACCOUNT_SECURITY_ACTION_DEFINITIONS_TOKEN = "users.core.accountSecurity.actionDefinitions";
const USERS_ACCOUNT_SECURITY_SERVICE_TOKEN = "users.accountSecurity.service";

function registerAccountSecurity(app) {
  if (!app || typeof app.singleton !== "function") {
    throw new Error("registerAccountSecurity requires application singleton().");
  }

  app.singleton(USERS_ACCOUNT_SECURITY_SERVICE_TOKEN, (scope) => {
    const authService = scope.has("authService") ? scope.make("authService") : null;
    return createAccountSecurityService({
      userSettingsRepository: scope.make("userSettingsRepository"),
      userProfilesRepository: scope.make("userProfilesRepository"),
      authService
    });
  });

  registerActionDefinitions(app, USERS_ACCOUNT_SECURITY_ACTION_DEFINITIONS_TOKEN, {
    contributorId: "users.account-security",
    domain: "settings",
    dependencies: {
      accountSecurityService: USERS_ACCOUNT_SECURITY_SERVICE_TOKEN
    },
    actions: accountSecurityActions
  });
}

export { registerAccountSecurity };
