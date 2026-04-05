import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { createService as createAccountSecurityService } from "./accountSecurityService.js";
import { accountSecurityActions } from "./accountSecurityActions.js";

function registerAccountSecurity(app) {
  if (!app || typeof app.singleton !== "function" || typeof app.actions !== "function") {
    throw new Error("registerAccountSecurity requires application singleton()/actions().");
  }

  app.singleton("users.accountSecurity.service", (scope) => {
    const authService = scope.has("authService") ? scope.make("authService") : null;
    return createAccountSecurityService({
      userSettingsRepository: scope.make("userSettingsRepository"),
      usersRepository: scope.make("usersRepository"),
      authService
    });
  });

  app.actions(
    withActionDefaults(accountSecurityActions, {
      domain: "settings",
      dependencies: {
        accountSecurityService: "users.accountSecurity.service"
      }
    })
  );
}

export { registerAccountSecurity };
