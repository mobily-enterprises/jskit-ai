import { createHash } from "node:crypto";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { validateGoogleAdsSearchPlan } from "../shared/google-ads-search.js";

const api = "https://googleads.googleapis.com/v25";
const scope = "https://www.googleapis.com/auth/adwords";
const customerId = { type: "string", required: true, validator: value => /^[0-9]{10}$/.test(value) || "Use a ten-digit customer ID." };
const id = { type: "string", required: true, validator: value => /^[0-9]{1,20}$/.test(value) || "Use a numeric campaign ID." };
const error = message => { throw new ConnectorError("connector_input_invalid", message, { statusCode: 422 }); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function requestOperation(fields, build, validateResult) {
  const schema = createSchema(fields);
  return { scopes: [scope], request(input, settings) {
    const values = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
    return { method: "POST", ...build(values), headers: settings.loginCustomerId ? { "login-customer-id": settings.loginCustomerId } : {} };
  }, validateResult };
}
const mutated = result => result && typeof result === "object" && !Array.isArray(result) && !result.partialFailureError &&
  (result.results === undefined || Array.isArray(result.results)) && (result.mutateOperationResponses === undefined || Array.isArray(result.mutateOperationResponses));

function searchMutation(plan, validateOnly) {
  const p = validateGoogleAdsSearchPlan(plan), root = `customers/${p.customerId}`;
  const budget = `${root}/campaignBudgets/-1`, campaign = `${root}/campaigns/-2`, group = `${root}/adGroups/-3`, goal = `${root}/customConversionGoals/-4`;
  return { url: `${api}/${root}/googleAds:mutate`, body: { validateOnly, partialFailure: false, mutateOperations: [
    { campaignBudgetOperation: { create: { resourceName: budget, name: `${p.name} budget`, amountMicros: p.dailyBudgetMicros, deliveryMethod: "STANDARD", explicitlyShared: false } } },
    { campaignOperation: { create: { resourceName: campaign, name: p.name, advertisingChannelType: "SEARCH", status: "PAUSED", campaignBudget: budget,
      manualCpc: {}, containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
      geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE" } } } },
    { customConversionGoalOperation: { create: { resourceName: goal, name: `${p.name} goal`, status: "ENABLED", conversionActions: [`${root}/conversionActions/${p.conversionActionId}`] } } },
    { conversionGoalCampaignConfigOperation: { update: { resourceName: `${root}/conversionGoalCampaignConfigs/-2`, goalConfigLevel: "CAMPAIGN", customConversionGoal: goal }, updateMask: "goal_config_level,custom_conversion_goal" } },
    ...p.locationIds.map(location => ({ campaignCriterionOperation: { create: { campaign, location: { geoTargetConstant: `geoTargetConstants/${location}` } } } })),
    { campaignCriterionOperation: { create: { campaign, language: { languageConstant: `languageConstants/${p.languageId}` } } } },
    { adGroupOperation: { create: { resourceName: group, name: `${p.name} group`, campaign, status: "ENABLED", type: "SEARCH_STANDARD", cpcBidMicros: p.maxCpcMicros } } },
    ...p.keywords.map(text => ({ adGroupCriterionOperation: { create: { adGroup: group, status: "ENABLED", keyword: { text, matchType: "PHRASE" } } } })),
    { adGroupAdOperation: { create: { adGroup: group, status: "ENABLED", ad: { finalUrls: [p.finalUrl], responsiveSearchAd: {
      headlines: p.headlines.map(text => ({ text })), descriptions: p.descriptions.map(text => ({ text })) } } } } }
  ] } };
}
const googleAdsSearchOperations = {
  "search.validate": { scopes: [scope], request: (input, settings) => ({ method: "POST", ...searchMutation(input, true), headers: settings.loginCustomerId ? { "login-customer-id": settings.loginCustomerId } : {} }), validateResult: mutated },
  "search.createPaused": { scopes: [scope], request: (input, settings) => ({ method: "POST", ...searchMutation(input, false), headers: settings.loginCustomerId ? { "login-customer-id": settings.loginCustomerId } : {} }), validateResult: result => mutated(result) && Array.isArray(result.mutateOperationResponses) && result.mutateOperationResponses.some(item => /^customers\/[0-9]{10}\/campaigns\/[0-9]+$/.test(item.campaignResult?.resourceName || "")) },
  "campaigns.setStatus": requestOperation({ customerId, campaignId: id, status: { type: "string", required: true, enum: ["PAUSED", "ENABLED"] } },
    p => ({ url: `${api}/customers/${p.customerId}/campaigns:mutate`, body: { operations: [{ update: { resourceName: `customers/${p.customerId}/campaigns/${p.campaignId}`, status: p.status }, updateMask: "status" }] } }), result => mutated(result) && result.results?.length === 1),
  "conversions.createWebsite": requestOperation({ customerId, name: { type: "string", required: true, minLength: 1, maxLength: 100 } },
    p => ({ url: `${api}/customers/${p.customerId}/conversionActions:mutate`, body: { operations: [{ create: { name: p.name, type: "WEBPAGE", category: "SUBMIT_LEAD_FORM", status: "ENABLED", countingType: "ONE_PER_CLICK", primaryForGoal: true } }] } }), result => mutated(result) && result.results?.length === 1)
};

// Application composition: this service has no editor protocol, command runner or storage.
function createGoogleAdsSearchService({ connections, configuration, context, integrationId }) {
  const slot = configuration.integrations?.[integrationId];
  if (slot?.provider !== "google-ads") error("Choose a Google Ads integration.");
  const invoke = (operation, input) => connections.invoke({ context, integrationId, operation, input });
  const query = async (customer, query) => (await invoke("reports.search", { customerId: customer, query })).results || [];
  const customer = value => validateSchemaPayload({ schema: createSchema({ customerId }), mode: "replace" }, { customerId: value }, { statusCode: 422 }).customerId;
  const campaignId = value => validateSchemaPayload({ schema: createSchema({ id }), mode: "replace" }, { id: value }, { statusCode: 422 }).id;
  const plan = () => validateGoogleAdsSearchPlan(configuration.extensions?.googleAdsSearch?.[integrationId]);
  const review = data => hash([context.applicationId, context.subjectId, integrationId, slot, plan(), data]);
  async function account(id) {
    const rows = await query(customer(id), "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status, customer.manager FROM customer LIMIT 1");
    if (rows.length !== 1) error("Google did not return the selected account.");
    return rows[0].customer;
  }
  async function preview() {
    const p = plan(), selected = await account(p.customerId);
    if (selected.manager || selected.status !== "ENABLED" || selected.currencyCode !== p.currency) error("Choose an active client account and match its currency.");
    const goals = await query(p.customerId, `SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type FROM conversion_action WHERE conversion_action.id = ${p.conversionActionId} LIMIT 1`);
    if (goals[0]?.conversionAction?.status !== "ENABLED" || goals[0]?.conversionAction?.type !== "WEBPAGE") error("Choose an enabled website conversion action.");
    await invoke("search.validate", p);
    const data = { plan: p, account: selected, conversion: goals[0].conversionAction };
    return { ...data, reviewId: review(data) };
  }
  async function campaign(id) {
    const p = plan(), selected = campaignId(id);
    const rows = await query(p.customerId, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.network_settings.target_google_search, campaign.network_settings.target_search_network, campaign.network_settings.target_content_network, campaign.network_settings.target_partner_search_network, campaign.geo_target_type_setting.positive_geo_target_type, campaign.geo_target_type_setting.negative_geo_target_type, campaign.contains_eu_political_advertising, campaign_budget.amount_micros, campaign_budget.id FROM campaign WHERE campaign.id = ${selected} LIMIT 1`);
    if (rows.length !== 1 || rows[0].campaign?.advertisingChannelType !== "SEARCH") error("Select an accessible Search campaign.");
    const details = {
      customerId: p.customerId, account: await account(p.customerId), ...rows[0],
      ads: await query(p.customerId, `SELECT ad_group_ad.ad.id, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.status, ad_group_ad.policy_summary.approval_status, ad_group.id, ad_group.status, ad_group.cpc_bid_micros FROM ad_group_ad WHERE campaign.id = ${selected} LIMIT 21`),
      goals: await query(p.customerId, `SELECT conversion_goal_campaign_config.goal_config_level, conversion_goal_campaign_config.custom_conversion_goal FROM conversion_goal_campaign_config WHERE conversion_goal_campaign_config.campaign = 'customers/${p.customerId}/campaigns/${selected}' LIMIT 1`),
      targets: await query(p.customerId, `SELECT campaign_criterion.type, campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant, campaign_criterion.negative FROM campaign_criterion WHERE campaign.id = ${selected} LIMIT 31`),
      keywords: await query(p.customerId, `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.negative, ad_group_criterion.status FROM keyword_view WHERE campaign.id = ${selected} LIMIT 31`)
    };
    const goalResource = details.goals[0]?.conversionGoalCampaignConfig?.customConversionGoal;
    if (goalResource) {
      if (!new RegExp(`^customers/${p.customerId}/customConversionGoals/[0-9]+$`).test(goalResource)) error("Google returned an invalid campaign goal.");
      details.customGoals = await query(p.customerId, `SELECT custom_conversion_goal.name, custom_conversion_goal.status, custom_conversion_goal.conversion_actions FROM custom_conversion_goal WHERE custom_conversion_goal.resource_name = '${goalResource}' LIMIT 1`);
    }
    if (details.ads.length > 20 || details.targets.length > 30 || details.keywords.length > 30) error("This campaign exceeds the bounded Search review. Manage it in Google Ads.");
    return { ...details, reviewId: review(details) };
  }
  return {
    async discover(id) {
      if (!id) return { accounts: (await invoke("customers.listAccessible", {})).resourceNames || [] };
      const selected = await account(id);
      return { account: selected,
        clients: selected.manager ? (await invoke("customers.listClients", { customerId: id })).results || [] : [],
        conversions: await query(id, "SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type, conversion_action.tag_snippets FROM conversion_action WHERE conversion_action.type = 'WEBPAGE' AND conversion_action.status = 'ENABLED' LIMIT 50"),
        campaigns: await query(id, "SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.advertising_channel_type = 'SEARCH' AND campaign.status != 'REMOVED' LIMIT 50") };
    },
    async targets(id, name) {
      customer(id);
      if (typeof name !== "string" || !/^[\p{L}\p{N} .-]{2,80}$/u.test(name)) error("Enter a location name using letters, numbers, spaces, dots or hyphens.");
      return { locations: await query(id, `SELECT geo_target_constant.id, geo_target_constant.canonical_name, geo_target_constant.status FROM geo_target_constant WHERE geo_target_constant.name LIKE '%${name}%' AND geo_target_constant.status = 'ENABLED' LIMIT 20`),
        languages: await query(id, "SELECT language_constant.id, language_constant.name FROM language_constant WHERE language_constant.targetable = TRUE LIMIT 100") };
    },
    preview,
    async create(reviewId) {
      const checked = await preview();
      if (reviewId !== checked.reviewId) error("The Search plan changed. Review it again before creation.");
      const response = await invoke("search.createPaused", checked.plan);
      const resource = response.mutateOperationResponses.find(item => item.campaignResult)?.campaignResult.resourceName;
      return { campaignId: resource.split("/").at(-1), status: "PAUSED" };
    },
    createConversion: ({ customerId, name }) => invoke("conversions.createWebsite", { customerId, name }),
    campaign,
    async launch({ campaignId, reviewId, trackingConfirmed, billingConfirmed }) {
      const current = await campaign(campaignId);
      if (current.reviewId !== reviewId) error("The campaign changed. Inspect and approve it again.");
      if (trackingConfirmed !== true || billingConfirmed !== true) error("Confirm installed conversion tracking and billing/advertiser readiness before launch.");
      if (current.account.manager || current.account.status !== "ENABLED") error("Choose an active client account.");
      if (current.campaign.containsEuPoliticalAdvertising !== "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING" ||
          !current.customGoals?.length || current.customGoals[0].customConversionGoal?.status !== "ENABLED") error("Review a non-political Search campaign with an enabled custom conversion goal.");
      if (!current.ads.length || !current.keywords.length || current.campaign.biddingStrategyType !== "MANUAL_CPC") error("This screen launches only Search campaigns with manual CPC, ads and keywords. Manage other campaigns in Google Ads.");
      if (current.campaign.status !== "PAUSED") error("Only a paused campaign can be launched here.");
      return invoke("campaigns.setStatus", { customerId: current.customerId, campaignId, status: "ENABLED" });
    },
    pause: id => invoke("campaigns.setStatus", { customerId: plan().customerId, campaignId: campaignId(id), status: "PAUSED" }),
    report: async () => ({ campaigns: await query(plan().customerId, "SELECT campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS AND campaign.advertising_channel_type = 'SEARCH' LIMIT 50") })
  };
}
export { googleAdsSearchOperations, createGoogleAdsSearchService };
