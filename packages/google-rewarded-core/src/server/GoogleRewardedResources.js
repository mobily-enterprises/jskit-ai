import { defineCrudJsonApiFeature } from "@jskit-ai/crud-core/server/defineCrudJsonApiFeature";
import { routeParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";
import { workspaceSlugParamsValidator } from "@jskit-ai/workspaces-core/server/validators/routeParamsValidator";
import { buildWorkspaceInputFromRouteParams } from "@jskit-ai/workspaces-core/server/support/workspaceRouteInput";
import { resource as providerConfigResource } from "../shared/googleRewardedProviderConfigResource.js";
import { resource as ruleResource } from "../shared/googleRewardedRuleResource.js";
import { resource as unlockReceiptResource } from "../shared/googleRewardedUnlockReceiptResource.js";
import { resource as watchSessionResource } from "../shared/googleRewardedWatchSessionResource.js";

function workspaceScope() {
  return {
    routeBase: "/w/:workspaceSlug",
    actionInputValidator: workspaceSlugParamsValidator,
    routeParamsValidator,
    inputKeys: ["workspaceSlug"],
    input: (request) => buildWorkspaceInputFromRouteParams(request.input.params)
  };
}

const GoogleRewardedRulesFeature = defineCrudJsonApiFeature({
  id: "google-rewarded.rules",
  capability: "google-rewarded.rules",
  resource: ruleResource,
  surface: "admin",
  ownershipFilter: "workspace",
  relativePath: "/google-rewarded-rules",
  internal: true,
  scope: workspaceScope()
});

const GoogleRewardedProviderConfigsFeature = defineCrudJsonApiFeature({
  id: "google-rewarded.provider-configs",
  capability: "google-rewarded.provider-configs",
  resource: providerConfigResource,
  surface: "admin",
  ownershipFilter: "workspace",
  relativePath: "/google-rewarded-provider-configs",
  internal: true,
  scope: workspaceScope()
});

const GoogleRewardedWatchSessionsFeature = defineCrudJsonApiFeature({
  id: "google-rewarded.watch-sessions",
  capability: "google-rewarded.watch-sessions",
  resource: watchSessionResource,
  surface: "admin",
  ownershipFilter: "workspace_user",
  relativePath: "/google-rewarded-watch-sessions",
  internal: true,
  scope: workspaceScope()
});

const GoogleRewardedUnlockReceiptsFeature = defineCrudJsonApiFeature({
  id: "google-rewarded.unlock-receipts",
  capability: "google-rewarded.unlock-receipts",
  resource: unlockReceiptResource,
  surface: "admin",
  ownershipFilter: "workspace_user",
  relativePath: "/google-rewarded-unlock-receipts",
  internal: true,
  scope: workspaceScope()
});

export {
  GoogleRewardedProviderConfigsFeature,
  GoogleRewardedRulesFeature,
  GoogleRewardedUnlockReceiptsFeature,
  GoogleRewardedWatchSessionsFeature
};
