import { defineCrudJsonApiFeature } from "@jskit-ai/crud-core/server/defineCrudJsonApiFeature";
import { WORKSPACE_CRUD_SCOPE } from "@jskit-ai/workspaces-core/server/support/workspaceCrud";
import { resource as providerConfigResource } from "../shared/rewardedProviderConfigResource.js";
import { resource as ruleResource } from "../shared/rewardedRuleResource.js";
import { resource as unlockReceiptResource } from "../shared/rewardedUnlockReceiptResource.js";
import { resource as watchSessionResource } from "../shared/rewardedWatchSessionResource.js";

const RewardedRulesFeature = defineCrudJsonApiFeature({
  id: "rewarded.rules",
  capability: "rewarded.rules",
  resource: ruleResource,
  surface: "admin",
  ownershipFilter: "workspace",
  relativePath: "/rewarded-rules",
  internal: true,
  scope: WORKSPACE_CRUD_SCOPE
});

const RewardedProviderConfigsFeature = defineCrudJsonApiFeature({
  id: "rewarded.provider-configs",
  capability: "rewarded.provider-configs",
  resource: providerConfigResource,
  surface: "admin",
  ownershipFilter: "workspace",
  relativePath: "/rewarded-provider-configs",
  internal: true,
  scope: WORKSPACE_CRUD_SCOPE
});

const RewardedWatchSessionsFeature = defineCrudJsonApiFeature({
  id: "rewarded.watch-sessions",
  capability: "rewarded.watch-sessions",
  resource: watchSessionResource,
  surface: "admin",
  ownershipFilter: "workspace_user",
  relativePath: "/rewarded-watch-sessions",
  internal: true,
  scope: WORKSPACE_CRUD_SCOPE
});

const RewardedUnlockReceiptsFeature = defineCrudJsonApiFeature({
  id: "rewarded.unlock-receipts",
  capability: "rewarded.unlock-receipts",
  resource: unlockReceiptResource,
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
