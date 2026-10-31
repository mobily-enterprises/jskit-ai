import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createService } from "./service.js";
import { createRewardedActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

const RewardedCoreFeature = defineFeature({
  id: "rewarded.core",
  domain: "rewarded",
  requires: {
    http: "runtime.http",
    grantPolicy: "rewarded.grant-policy",
    providerConfigs: "rewarded.provider-configs",
    rules: "rewarded.rules",
    unlockReceipts: "rewarded.unlock-receipts",
    watchSessions: "rewarded.watch-sessions"
  },
  provides: {
    rewarded: "rewarded.core"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("./types.js").RewardedGrantPolicy} capabilities.grantPolicy
   * @param {import("./types.js").RewardedProviderConfigs} capabilities.providerConfigs
   * @param {import("./types.js").RewardedRules} capabilities.rules
   * @param {import("./types.js").RewardedUnlockReceipts} capabilities.unlockReceipts
   * @param {import("./types.js").RewardedWatchSessions} capabilities.watchSessions
   */
  setup({ http, grantPolicy, providerConfigs, rules, unlockReceipts, watchSessions }) {
    // readable-check: allow method-probe - input validation: the application provides rewarded.grant-policy
    if (typeof grantPolicy.authorizeGrant !== "function") {
      throw new TypeError("rewarded.grant-policy requires authorizeGrant.");
    }
    const rewarded = createService({
      authorizeGrant: (input) => grantPolicy.authorizeGrant(input),
      rewardedRulesRepository: rules.repository,
      rewardedProviderConfigsRepository: providerConfigs.repository,
      rewardedWatchSessionsRepository: watchSessions.repository,
      rewardedUnlockReceiptsRepository: unlockReceipts.repository
    });
    registerRoutes(http.router, {
      routeOwnershipFilter: "workspace_user",
      routeSurface: "app",
      routeRelativePath: "rewarded"
    });
    return { rewarded };
  },
  actions({ rewarded }) {
    return createRewardedActions({ rewarded });
  }
});

export { RewardedCoreFeature };
