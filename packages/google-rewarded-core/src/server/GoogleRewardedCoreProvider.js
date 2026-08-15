import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createService } from "./service.js";
import { createGoogleRewardedActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

const GoogleRewardedCoreFeature = defineFeature({
  id: "google-rewarded.core",
  domain: "google-rewarded",
  requires: {
    http: "runtime.http",
    providerConfigs: "google-rewarded.provider-configs",
    rules: "google-rewarded.rules",
    unlockReceipts: "google-rewarded.unlock-receipts",
    watchSessions: "google-rewarded.watch-sessions"
  },
  provides: {
    googleRewarded: "google-rewarded.core"
  },
  setup({ http, providerConfigs, rules, unlockReceipts, watchSessions }) {
    const googleRewarded = createService({
      googleRewardedRulesRepository: rules.repository,
      googleRewardedProviderConfigsRepository: providerConfigs.repository,
      googleRewardedWatchSessionsRepository: watchSessions.repository,
      googleRewardedUnlockReceiptsRepository: unlockReceipts.repository
    });
    registerRoutes(http.router, {
      routeOwnershipFilter: "workspace_user",
      routeSurface: "app",
      routeRelativePath: "google-rewarded"
    });
    return { googleRewarded };
  },
  actions({ googleRewarded }) {
    return createGoogleRewardedActions({ googleRewarded });
  }
});

export { GoogleRewardedCoreFeature };
