import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { createService } from "./service.js";
import { googleRewardedActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

class GoogleRewardedCoreProvider {
  static id = "google-rewarded.core";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("GoogleRewardedCoreProvider requires application singleton()/service()/actions().");
    }

    app.service(
      "google-rewarded.core.service",
      (scope) => createService({
        googleRewardedRulesRepository: scope.make("repository.google_rewarded_rules"),
        googleRewardedProviderConfigsRepository: scope.make("repository.google_rewarded_provider_configs"),
        googleRewardedWatchSessionsRepository: scope.make("repository.google_rewarded_watch_sessions"),
        googleRewardedUnlockReceiptsRepository: scope.make("repository.google_rewarded_unlock_receipts")
      })
    );

    app.actions(
      withActionDefaults(googleRewardedActions, {
        domain: "google-rewarded",
        dependencies: {
          googleRewardedService: "google-rewarded.core.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeOwnershipFilter: "workspace_user",
      routeSurface: "app",
      routeRelativePath: "google-rewarded"
    });
  }
}

export { GoogleRewardedCoreProvider };
