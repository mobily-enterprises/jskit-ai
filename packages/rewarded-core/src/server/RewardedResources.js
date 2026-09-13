import { defineCrudJsonApiFeature } from "@jskit-ai/crud-core/server/defineCrudJsonApiFeature";
import { routeParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";
import { workspaceSlugParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";
import { buildWorkspaceInputFromRouteParams } from "@jskit-ai/workspaces-core/server/support/workspaceRouteInput";
import { resource as providerConfigResource } from "../shared/rewardedProviderConfigResource.js";
import { resource as ruleResource } from "../shared/rewardedRuleResource.js";
import { resource as unlockReceiptResource } from "../shared/rewardedUnlockReceiptResource.js";
import { resource as watchSessionResource } from "../shared/rewardedWatchSessionResource.js";

function workspaceScope() {
  return {
    routeBase: "/w/:workspaceSlug",
    actionInputValidator: workspaceSlugParamsValidator,
    routeParamsValidator,
    inputKeys: ["workspaceSlug"],
    input: (request) => buildWorkspaceInputFromRouteParams(request.input.params)
  };
}

const RewardedRulesFeature = defineCrudJsonApiFeature({
  id: "rewarded.rules",
  capability: "rewarded.rules",
  resource: ruleResource,
  surface: "admin",
  ownershipFilter: "workspace",
  relativePath: "/rewarded-rules",
  internal: true,
  scope: workspaceScope()
});

const RewardedProviderConfigsFeature = defineCrudJsonApiFeature({
  id: "rewarded.provider-configs",
  capability: "rewarded.provider-configs",
  resource: providerConfigResource,
  surface: "admin",
  ownershipFilter: "workspace",
  relativePath: "/rewarded-provider-configs",
  internal: true,
  scope: workspaceScope()
});

const RewardedWatchSessionsFeature = defineCrudJsonApiFeature({
  id: "rewarded.watch-sessions",
  capability: "rewarded.watch-sessions",
  resource: watchSessionResource,
  surface: "admin",
  ownershipFilter: "workspace_user",
  relativePath: "/rewarded-watch-sessions",
  internal: true,
  scope: workspaceScope()
});

const RewardedUnlockReceiptsFeature = defineCrudJsonApiFeature({
  id: "rewarded.unlock-receipts",
  capability: "rewarded.unlock-receipts",
  resource: unlockReceiptResource,
  surface: "admin",
  ownershipFilter: "workspace_user",
  relativePath: "/rewarded-unlock-receipts",
  internal: true,
  scope: workspaceScope()
});

export {
  RewardedProviderConfigsFeature,
  RewardedRulesFeature,
  RewardedUnlockReceiptsFeature,
  RewardedWatchSessionsFeature
};
