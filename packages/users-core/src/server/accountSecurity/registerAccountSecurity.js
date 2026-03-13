import { createService as createAccountSecurityService } from "./accountSecurityService.js";
import { accountSecurityActions } from "./accountSecurityActions.js";

const USERS_ACCOUNT_SECURITY_SERVICE_TOKEN = "users.accountSecurity.service";

function registerAccountSecurity(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.actions !== "function") {
    throw new Error("registerAccountSecurity requires application singleton()/actions().");
  }

  app.singleton(USERS_ACCOUNT_SECURITY_SERVICE_TOKEN, (scope) => {
    const authService = scope.has("authService") ? scope.make("authService") : null;
    return createAccountSecurityService({
      userSettingsRepository: scope.make("userSettingsRepository"),
      userProfilesRepository: scope.make("userProfilesRepository"),
      authService
    });
  });

  app.actions({
    contributorId: "users.account-security",
    domain: "settings",
    dependencies: {
      accountSecurityService: USERS_ACCOUNT_SECURITY_SERVICE_TOKEN
    },
    actions: accountSecurityActions
  });
}

export { registerAccountSecurity };
