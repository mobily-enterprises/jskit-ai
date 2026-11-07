import { defineCrudFeature } from "@jskit-ai/crud-core/server/defineCrudFeature";
import { WORKSPACE_CRUD_SCOPE } from "@jskit-ai/workspaces-core/server/support/workspaceCrud";
import { rewardedProviderConfigCrud } from "../shared/rewardedProviderConfigResource.js";
import { rewardedRuleCrud } from "../shared/rewardedRuleResource.js";
import { rewardedUnlockReceiptCrud } from "../shared/rewardedUnlockReceiptResource.js";
import { rewardedWatchSessionCrud } from "../shared/rewardedWatchSessionResource.js";

const RewardedRulesFeature = defineCrudFeature({
  id: "rewarded.rules",
  capability: "rewarded.rules",
  crud: rewardedRuleCrud,
  surface: "admin",
  relativePath: "/rewarded-rules",
  internal: true,
  scope: WORKSPACE_CRUD_SCOPE
});

const RewardedProviderConfigsFeature = defineCrudFeature({
  id: "rewarded.provider-configs",
  capability: "rewarded.provider-configs",
  crud: rewardedProviderConfigCrud,
  surface: "admin",
  relativePath: "/rewarded-provider-configs",
  internal: true,
  scope: WORKSPACE_CRUD_SCOPE
});

const RewardedWatchSessionsFeature = defineCrudFeature({
  id: "rewarded.watch-sessions",
  capability: "rewarded.watch-sessions",
  crud: rewardedWatchSessionCrud,
  surface: "admin",
  relativePath: "/rewarded-watch-sessions",
  internal: true,
  scope: WORKSPACE_CRUD_SCOPE
});

const RewardedUnlockReceiptsFeature = defineCrudFeature({
  id: "rewarded.unlock-receipts",
  capability: "rewarded.unlock-receipts",
  crud: rewardedUnlockReceiptCrud,
  surface: "admin",
  relativePath: "/rewarded-unlock-receipts",
  internal: true,
  scope: WORKSPACE_CRUD_SCOPE
});

export {
  RewardedProviderConfigsFeature,
  RewardedRulesFeature,
  RewardedUnlockReceiptsFeature,
  RewardedWatchSessionsFeature
};
