import { defineCrudJsonApiFeature } from "@jskit-ai/crud-core/server/defineCrudJsonApiFeature";
import { WORKSPACE_CRUD_SCOPE } from "@jskit-ai/workspaces-core/server/support/workspaceCrud";
import { rewardedProviderConfigCrud } from "../shared/rewardedProviderConfigResource.js";
import { rewardedRuleCrud } from "../shared/rewardedRuleResource.js";
import { rewardedUnlockReceiptCrud } from "../shared/rewardedUnlockReceiptResource.js";
import { rewardedWatchSessionCrud } from "../shared/rewardedWatchSessionResource.js";

const RewardedRulesFeature = defineCrudJsonApiFeature({
  id: "rewarded.rules",
  capability: "rewarded.rules",
  resource: rewardedRuleCrud,
  surface: "admin",
  ownershipFilter: "workspace",
  relativePath: "/rewarded-rules",
  internal: true,
  scope: WORKSPACE_CRUD_SCOPE
});

const RewardedProviderConfigsFeature = defineCrudJsonApiFeature({
  id: "rewarded.provider-configs",
  capability: "rewarded.provider-configs",
  resource: rewardedProviderConfigCrud,
  surface: "admin",
  ownershipFilter: "workspace",
  relativePath: "/rewarded-provider-configs",
  internal: true,
  scope: WORKSPACE_CRUD_SCOPE
});

const RewardedWatchSessionsFeature = defineCrudJsonApiFeature({
  id: "rewarded.watch-sessions",
  capability: "rewarded.watch-sessions",
  resource: rewardedWatchSessionCrud,
  surface: "admin",
  ownershipFilter: "workspace_user",
  relativePath: "/rewarded-watch-sessions",
  internal: true,
  scope: WORKSPACE_CRUD_SCOPE
});

const RewardedUnlockReceiptsFeature = defineCrudJsonApiFeature({
  id: "rewarded.unlock-receipts",
  capability: "rewarded.unlock-receipts",
  resource: rewardedUnlockReceiptCrud,
  surface: "admin",
  ownershipFilter: "workspace_user",
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
