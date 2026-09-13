import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { validateIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { createGoogleAdsSearchService } from "../src/server/google-ads-search.js";
import { validateGoogleAdsSearchPlan } from "../src/shared/google-ads-search.js";
import { dispatchAdsSetup } from "../patterns/google-ads-search/example/ads-setup.js";
import { googleAdsProvider as provider } from "../src/server/google-ads.js";

const context = { applicationId: "ads-app", subjectId: "user-one" };
const input = { context, integrationId: "ads" };
const callback = "https://app.example.test/connections/google-ads/callback";
const scope = "https://www.googleapis.com/auth/adwords";
const customerId = "1234567890";
const report = { results: [{ campaign: { id: "9007199254740993", name: "Fixture" }, metrics: { impressions: "9007199254740995", costMicros: "2200000" } }],
  fieldMask: "campaign.id,campaign.name,metrics.impressions,metrics.costMicros", nextPageToken: "fixture+/=", totalResultsCount: "9007199254740996" };
const query = "SELECT campaign.id, campaign.name, metrics.impressions, metrics.cost_micros FROM campaign WHERE campaign.name = 'A + B & 😀' LIMIT 20";

async function fixture(t, settings = { loginCustomerId: "9876543210" }) {
  const directory = await mkdtemp(path.join(tmpdir(), "google-ads-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(6) }, activeKeyId: "current" });
  const configuration = { schemaVersion: 1, integrations: { ads: { provider: "google-ads", accountMode: "per-user", settings,
    scopes: [scope], authentication: { method: "oauth2", registrationRef: "google" } } },
  registrations: { google: { source: "own", clientId: "fixture-client", clientSecretRef: "env:SECRET", callbackUrlRef: "env:CALLBACK" } } };
  const state = { time: Date.now(), calls: [], resolved: [], secret: "secret-fixture", grants: 0,
    response: report, accounts: { resourceNames: ["customers/1234567890", "customers/9876543210"] }, scope, status: 200, tokenStatus: 200,
    refresh: true, deny: false, stall: false };
  const options = { configuration, providers: [provider], store: createFileConnectionStore({ directory, protection }), now: () => state.time,
    authorize: async (owner) => { if (state.deny) throw new Error("Host denied"); return owner; },
    resolveReference: async (ref) => {
      state.resolved.push(ref);
      if (ref === "env:CALLBACK") return callback;
      if (ref === "env:SECRET") return state.secret;
      throw new Error("Unknown reference");
    },
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)); const headers = new Headers(init.headers);
      state.calls.push({ url, init, headers });
      const token = url.href === "https://oauth2.googleapis.com/token";
      if (state.stall === true || state.stall === (token ? "token" : "api")) return new Promise((resolve, reject) => {
        init.signal.throwIfAborted(); init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
      if (token) {
        assert.equal(init.redirect, "manual"); assert.equal(headers.has("developer-token"), false); assert.equal(headers.has("login-customer-id"), false);
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), "fixture-client"); assert.equal(body.get("client_secret"), state.secret);
        if (body.get("grant_type") === "refresh_token") assert.equal(body.get("refresh_token"), state.lastRefresh);
        if (state.tokenStatus !== 200) return Response.json({ error: "invalid_grant", error_description: "private-binding-value" }, { status: state.tokenStatus });
        state.grants++;
        if (state.refresh) state.lastRefresh = `refresh-fixture-${state.grants}`;
        return Response.json({ access_token: `access-fixture-${state.grants}`, token_type: "Bearer", expires_in: 3600, scope: state.scope,
          ...(state.refresh ? { refresh_token: state.lastRefresh } : {}) });
      }
      assert.equal(url.origin, "https://googleads.googleapis.com"); assert.ok(url.pathname.startsWith("/v25/"));
      assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error");
      assert.equal(headers.get("authorization"), `Bearer access-fixture-${state.grants}`);
      assert.equal(headers.get("developer-token"), null);
      assert.equal(url.search, "");
      const accounts = url.pathname.endsWith(":listAccessibleCustomers");
      assert.equal(init.method, accounts ? "GET" : "POST");
      assert.equal(headers.get("login-customer-id"), accounts ? null : settings.loginCustomerId || null);
      if (accounts) assert.equal(init.body, undefined);
      else { assert.equal(headers.get("content-type"), "application/json"); assert.equal(typeof init.body, "string"); }
      if (state.raw !== undefined) return new Response(state.raw, { status: state.status, headers: { "Content-Type": "application/json" } });
      if (state.status !== 200 || state.error) return Response.json({ error: state.error || { status: "UNKNOWN", message: "private-binding-value" } }, { status: state.status });
      return Response.json(accounts ? state.accounts : state.respond ? state.respond(url, JSON.parse(init.body)) : state.response);
    }
  };
  const service = createConnectionService(options);
  const start = async (target = service) => {
    const result = await target.beginAuthorization(input); const url = new URL(result.authorizationUrl);
    const returned = new URL(callback); returned.searchParams.set("code", "fixture-code"); returned.searchParams.set("state", url.searchParams.get("state"));
    return { url, callbackUrl: returned.href };
  };
  const connect = async (target = service) => target.completeAuthorization({ ...input, callbackUrl: (await start(target)).callbackUrl });
  const invoke = (values = { customerId, query }, target = service) => target.invoke({ ...input, operation: "reports.search", input: values });
  return { options, service, state, directory, protection, configuration, start, connect, invoke };
}

test("Google Ads CLI validates project access settings and rejects retired credential modes", async (t) => {
  const f = await fixture(t);
  for (const settings of [{}, { loginCustomerId: customerId }]) {
    const config = structuredClone(f.configuration); config.integrations.ads.settings = settings;
    assert.deepEqual(validateIntegrationConfiguration(config, { providers: [provider] }).integrations.ads.settings, settings);
  }
  for (const settings of [{ apiAccess: "developer-token" }, { apiAccess: "cloud-organization" }, { developerTokenRef: "env:ADS_TOKEN" },
    ...["123-456-7890", "123", " 1234567890", "123456789x"].map(loginCustomerId => ({ loginCustomerId }))]) {
    const config = structuredClone(f.configuration); config.integrations.ads.settings = settings;
    assert.throws(() => validateIntegrationConfiguration(config, { providers: [provider] }));
  }
});

test("Google Ads verifies direct accounts through fixed OAuth PKCE and omits retired developer tokens and scopes manager headers", async (t) => {
  for (const settings of [{ loginCustomerId: "9876543210" }, {}]) {
    const f = await fixture(t, settings); const { url, callbackUrl } = await f.start();
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("scope"), scope); assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("access_type"), "offline"); assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("redirect_uri"), callback); assert.equal(url.searchParams.has("client_secret"), false);
    assert.equal((await f.service.completeAuthorization({ ...input, callbackUrl })).status, "connected");
    assert.equal(f.state.calls.length, 2); assert.equal(f.state.calls[1].url.pathname, "/v25/customers:listAccessibleCustomers");
    assert.equal(f.state.resolved.includes("env:ADS_TOKEN"), false);
    await assert.rejects(f.service.completeAuthorization({ ...input, callbackUrl }));
  }
});

test("Google Ads reports preserve GAQL, opaque pages and int64 strings; hierarchy reads have fixed queries", async (t) => {
  for (const settings of [{ loginCustomerId: "9876543210" }, {}]) {
    const f = await fixture(t, settings); await f.connect();
    assert.deepEqual(await f.invoke(), report);
    assert.deepEqual(JSON.parse(f.state.calls.at(-1).init.body), { query });
    await f.invoke({ customerId, query, pageToken: report.nextPageToken });
    assert.deepEqual(JSON.parse(f.state.calls.at(-1).init.body), { query, pageToken: report.nextPageToken });
    assert.equal(f.state.calls.at(-1).url.pathname, `/v25/customers/${customerId}/googleAds:search`);
    await f.service.invoke({ ...input, operation: "customers.listClients", input: { customerId } });
    const body = JSON.parse(f.state.calls.at(-1).init.body);
    assert.ok(body.query.includes("FROM customer_client")); assert.ok(body.query.includes("customer_client.level"));
    for (const empty of [{}, { results: [] }, { fieldMask: "campaign.id", totalResultsCount: "0", nextPageToken: "" }]) {
      f.state.response = empty; assert.deepEqual(await f.invoke(), empty);
    }
    f.state.accounts = {};
    assert.deepEqual(await f.service.invoke({ ...input, operation: "customers.listAccessible" }), {});
  }
});

test("Google Ads rejects malformed IDs, unbounded queries and caller transport fields before API access", async (t) => {
  const f = await fixture(t); await f.connect();
  const invalid = [{ customerId: "123-456-7890", query }, { customerId: "1234567890/../x", query },
    { customerId, query: "DELETE FROM campaign" }, { customerId, query: "SELECT\nx FROM campaign" }, { customerId, query: "SELECT " + "a".repeat(16000) },
    { customerId, query: "SELECT '" + "😀".repeat(8001) + "' FROM campaign" }, { customerId, query, pageToken: "a\nb" },
    { customerId, query, pageToken: "a".repeat(4097) }, { customerId, query, pageSize: 50 }, { customerId, query, headers: { "developer-token": "evil" } },
    { customerId, query, url: "https://evil.invalid" }, { customerId, query, loginCustomerId: "1111111111" }];
  for (const values of invalid) {
    const calls = f.state.calls.length; const resolved = f.state.resolved.filter((ref) => ref === "env:ADS_TOKEN").length;
    await assert.rejects(f.invoke(values), { code: "connector_input_invalid" });
    assert.equal(f.state.calls.length, calls); assert.equal(f.state.resolved.filter((ref) => ref === "env:ADS_TOKEN").length, resolved);
  }
  await assert.rejects(f.service.invoke({ ...input, operation: "customers.listClients", input: { customerId, query } }), { code: "connector_input_invalid" });
  await assert.rejects(f.service.invoke({ ...input, operation: "customers.listAccessible", input: { customerId } }), { code: "connector_input_invalid" });
});

test("Google Ads encrypted file grants survive restart, isolate owners, renew once and retain refresh tokens", async (t) => {
  const f = await fixture(t); await f.connect();
  const restarted = createConnectionService({ ...f.options, store: createFileConnectionStore({ directory: f.directory, protection: f.protection }) });
  assert.equal((await restarted.status(input)).status, "connected");
  await assert.rejects(restarted.invoke({ ...input, context: { ...context, subjectId: "user-two" }, operation: "customers.listAccessible" }), { code: "connector_reconnect_required" });
  await assert.rejects(restarted.invoke({ ...input, context: { ...context, applicationId: "other-app" }, operation: "customers.listAccessible" }), { code: "connector_reconnect_required" });
  f.state.time += 3600000; f.state.refresh = false;
  await Promise.all([f.invoke(undefined, restarted), f.invoke(undefined, createConnectionService(f.options))]);
  assert.equal(f.state.grants, 2); assert.equal(f.state.lastRefresh, "refresh-fixture-1");
  f.state.time += 3600000; f.state.refresh = true; await f.invoke(undefined, restarted);
  assert.equal(f.state.grants, 3); assert.equal(f.state.lastRefresh, "refresh-fixture-3");
  for (const file of await readdir(f.directory)) {
    const text = await readFile(path.join(f.directory, file), "utf8");
    for (const secret of ["secret-fixture", "access-fixture", "refresh-fixture"]) assert.equal(text.includes(secret), false);
  }
  const status = JSON.stringify(await restarted.status(input)); assert.equal(status.includes("access-fixture"), false);
  await restarted.disconnect(input); assert.equal((await restarted.status(input)).status, "disconnected");
});

test("Google Ads settings and client changes invalidate saved access and in-progress consent", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const change of ["manager", "client"]) {
    const started = await f.start(); const configuration = structuredClone(f.configuration);
    if (change === "manager") configuration.integrations.ads.settings.loginCustomerId = "1111111111";
    if (change === "client") configuration.registrations.google.clientId = "different-client";
    const changed = createConnectionService({ ...f.options, configuration }); const calls = f.state.calls.length;
    await assert.rejects(changed.invoke({ ...input, operation: "customers.listAccessible" }), { code: "connector_reconnect_required" });
    await assert.rejects(changed.completeAuthorization({ ...input, callbackUrl: started.callbackUrl }));
    assert.equal(f.state.calls.length, calls);
  }
  const configuration = structuredClone(f.configuration);
  configuration.registrations.google.clientSecretRef = "env:MISSING";
  const missing = createConnectionService({ ...f.options, configuration });
  await assert.rejects(f.invoke(undefined, missing), { code: "connector_binding_missing" });
});

test("Google Ads validates malformed report/account responses and handles protobuf empty fields", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const response of [[], null, { results: {} }, { results: [null] }, { results: Array(10001).fill({}) }, { nextPageToken: 5 },
    { nextPageToken: "a\nb" }, { nextPageToken: "a".repeat(4097) }, { totalResultsCount: 5 }, { totalResultsCount: "-1" }, { fieldMask: [] }]) {
    f.state.response = response; await assert.rejects(f.invoke(), { code: "connector_response_invalid" });
  }
  for (const accounts of [{ resourceNames: {} }, { resourceNames: ["customers/123-456-7890"] }, { resourceNames: [null] }]) {
    f.state.accounts = accounts;
    await assert.rejects(f.service.invoke({ ...input, operation: "customers.listAccessible" }), { code: "connector_response_invalid" });
  }
  f.state.raw = "not JSON"; await assert.rejects(f.invoke(), { code: "connector_response_invalid" });
});

test("Google Ads distinguishes API approval, quota, scope, account and query failures without exposing details or replaying", async (t) => {
  const f = await fixture(t); await f.connect();
  const failure = (field, code) => ({ message: "private-binding-value", details: [{ errors: [{ errorCode: { [field]: code }, message: query }] }] });
  for (const [status, error, code] of [
    [403, failure("authorizationError", "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION"), "connector_api_access_invalid"],
    [401, failure("authenticationError", "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION"), "connector_api_access_invalid"],
    [400, failure("quotaError", "RESOURCE_EXHAUSTED"), "connector_rate_limited"],
    [429, { status: "RESOURCE_EXHAUSTED" }, "connector_rate_limited"],
    [403, { details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] }, "connector_scope_missing"],
    [400, failure("queryError", "UNRECOGNIZED_FIELD"), "connector_input_invalid"],
    [403, failure("authorizationError", "USER_PERMISSION_DENIED"), "connector_permission_denied"],
    [404, {}, "connector_resource_not_found"], [500, {}, "connector_provider_failed"], [302, {}, "connector_provider_failed"],
    [200, { message: "private-binding-value" }, "connector_provider_failed"]
  ]) {
    f.state.status = status; f.state.error = error; const calls = f.state.calls.length;
    await assert.rejects(f.invoke(), (actual) => actual.code === code && !actual.message.includes("private-binding-value") && !actual.message.includes(query));
    assert.equal(f.state.calls.length, calls + 1); assert.equal((await f.service.status(input)).status, "connected");
  }
  f.state.status = 401; f.state.error = failure("authenticationError", "OAUTH_TOKEN_REVOKED");
  await assert.rejects(f.invoke(), { code: "connector_reconnect_required" });
  assert.equal((await f.service.status(input)).status, "reconnect-required");
});

test("Google Ads host policy sees immutable account/query inputs and denies before credentials or HTTP", async (t) => {
  const f = await fixture(t); await f.connect(); const values = { customerId, query };
  const authorized = createConnectionService({ ...f.options, authorize: async (owner, operation) => {
    if (operation.operation === "reports.search") {
      assert.deepEqual(operation.input, { customerId, query }); operation.input.customerId = "1111111111"; values.query = "SELECT customer.id FROM customer";
    }
    return owner;
  } });
  await f.invoke(values, authorized); assert.equal(JSON.parse(f.state.calls.at(-1).init.body).query, query);
  assert.equal(f.state.calls.at(-1).url.pathname, `/v25/customers/${customerId}/googleAds:search`);
  f.state.deny = true; const calls = f.state.calls.length; const resolved = f.state.resolved.length;
  await assert.rejects(f.invoke()); assert.equal(f.state.calls.length, calls); assert.equal(f.state.resolved.length, resolved);
});

test("Google Ads rejects declined or insufficient consent and keeps managed assignment explicitly unavailable", async (t) => {
  const f = await fixture(t); const started = await f.start();
  const declined = new URL(started.callbackUrl); declined.searchParams.delete("code"); declined.searchParams.set("error", "access_denied");
  await assert.rejects(f.service.completeAuthorization({ ...input, callbackUrl: declined.href })); assert.equal(f.state.calls.length, 0);
  f.state.scope = "openid"; await assert.rejects(f.connect(), { code: "connector_scope_missing" }); assert.equal(f.state.calls.length, 1);
  const configuration = structuredClone(f.configuration);
  configuration.registrations.google = { source: "managed", serviceUrlRef: "env:GATEWAY", serviceCredentialRef: "env:IDENTITY", assignmentRef: "public" };
  assert.throws(() => createConnectionService({ ...f.options, configuration }), { code: "integration_configuration_invalid" });
});

test("Google Ads refresh scope reduction, API cancellation and timeout do not replay requests", async (t) => {
  // The fake transport has no socket to keep Node 22 alive for an unrefed timeout.
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keepAlive));
  const f = await fixture(t); await f.connect(); f.state.stall = "api";
  const timed = createConnectionService({ ...f.options, providers: [{ ...provider, requestTimeoutMs: 20 }] });
  await assert.rejects(f.invoke(undefined, timed), { code: "connector_provider_timeout" });
  const controller = new AbortController(); const pending = f.service.invoke({ ...input, operation: "reports.search", input: { customerId, query }, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 20); await assert.rejects(pending, { code: "connector_cancelled" }); clearTimeout(timer);
  f.state.stall = false; f.state.time += 3600000; f.state.scope = "openid";
  const calls = f.state.calls.length; await assert.rejects(f.invoke(), { code: "connector_scope_missing" }); assert.equal(f.state.calls.length, calls + 1);
  const revoked = await fixture(t); await revoked.connect(); revoked.state.time += 3600000; revoked.state.tokenStatus = 400;
  await assert.rejects(revoked.invoke(), { code: "connector_reconnect_required" });
});

test("Google Ads provider guide JSON uses the real portable validator", async () => {
  const text = await readFile(new URL("../docs/google-ads.md", import.meta.url), "utf8");
  const config = JSON.parse(text.match(/```json\n([\s\S]*?)\n```/u)[1]);
  assert.deepEqual(validateIntegrationConfiguration(config, { providers: [provider] }), config);
});

const searchPlan = { customerId, name: "Dog grooming leads", currency: "AUD", dailyBudgetMicros: "12000000", maxCpcMicros: "1500000",
  finalUrl: "https://dog.example.test/book", conversionActionId: "22", locationIds: ["2036"], languageId: "1000", nonPolitical: true,
  keywords: ["dog grooming"], headlines: ["Book Dog Grooming", "Local Groomers", "Make A Booking"], descriptions: ["Book an appointment for your dog.", "Meet our experienced team."] };
async function searchFixture(t) {
  const f = await fixture(t); await f.connect();
  f.configuration.extensions = { googleAdsSearch: { ads: structuredClone(searchPlan) } };
  const live = { campaign: { id: "33", name: searchPlan.name, status: "PAUSED", advertisingChannelType: "SEARCH", biddingStrategyType: "MANUAL_CPC",
    containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING" }, campaignBudget: { amountMicros: "12000000", id: "44" } };
  f.state.respond = (url, body) => {
    if (url.pathname.endsWith("googleAds:mutate")) return body.validateOnly ? {} : { mutateOperationResponses: [{ campaignResult: { resourceName: `customers/${customerId}/campaigns/33` } }] };
    if (url.pathname.endsWith("campaigns:mutate")) { live.campaign.status = body.operations[0].update.status; return { results: [{ resourceName: `customers/${customerId}/campaigns/33` }] }; }
    if (url.pathname.endsWith("conversionActions:mutate")) return { results: [{ resourceName: `customers/${customerId}/conversionActions/22` }] };
    const q = body.query;
    if (q.includes("FROM customer ")) return { results: [{ customer: { id: customerId, descriptiveName: "Dog And Groom", currencyCode: "AUD", timeZone: "Australia/Perth", status: "ENABLED", manager: false } }] };
    if (q.includes("FROM conversion_action")) return { results: [{ conversionAction: { id: "22", name: "Booking", type: "WEBPAGE", status: "ENABLED", tagSnippets: [{ eventSnippet: "<script>fixture-only</script>" }] } }] };
    if (q.includes("FROM geo_target_constant")) return { results: [{ geoTargetConstant: { id: "2036", canonicalName: "Australia" } }] };
    if (q.includes("FROM language_constant")) return { results: [{ languageConstant: { id: "1000", name: "English" } }] };
    if (q.includes("FROM ad_group_ad")) return { results: [{ adGroupAd: { ad: { id: "55", finalUrls: [searchPlan.finalUrl] }, status: "ENABLED" }, adGroup: { cpcBidMicros: "1500000" } }] };
    if (q.includes("FROM conversion_goal_campaign_config")) return { results: [{ conversionGoalCampaignConfig: { goalConfigLevel: "CAMPAIGN", customConversionGoal: `customers/${customerId}/customConversionGoals/66` } }] };
    if (q.includes("FROM custom_conversion_goal")) return { results: [{ customConversionGoal: { status: "ENABLED", name: "Booking", conversionActions: [`customers/${customerId}/conversionActions/22`] } }] };
    if (q.includes("FROM campaign_criterion")) return { results: [{ campaignCriterion: { type: "LOCATION", location: { geoTargetConstant: "geoTargetConstants/2036" } } }] };
    if (q.includes("FROM keyword_view")) return { results: [{ adGroupCriterion: { keyword: { text: "dog grooming", matchType: "PHRASE" } } }] };
    if (q.includes("FROM campaign")) return { results: [structuredClone(live)] };
    throw new Error(`Unexpected fixture query: ${q}`);
  };
  return { ...f, live, ads: createGoogleAdsSearchService({ connections: f.service, configuration: f.configuration, context, integrationId: "ads" }) };
}

test("Search plan rejects ambiguous money, missing targeting and political campaigns before HTTP", () => {
  assert.deepEqual(validateGoogleAdsSearchPlan(searchPlan), searchPlan);
  for (const invalid of [{ dailyBudgetMicros: 12000000 }, { maxCpcMicros: "1.5" }, { dailyBudgetMicros: "0" }, { locationIds: [] },
    { headlines: ["Only one"] }, { nonPolitical: false }, { finalUrl: "javascript:alert(1)" }, { customerId: "123-456-7890" }, { currency: "aud" }]) {
    assert.throws(() => validateGoogleAdsSearchPlan({ ...searchPlan, ...invalid }), JSON.stringify(invalid));
  }
});

test("Search workflow uses existing consent, Google validation, atomic paused creation and separate reviewed launch", async t => {
  const f = await searchFixture(t);
  assert.equal((await f.ads.discover(customerId)).account.currencyCode, "AUD");
  assert.equal((await f.ads.targets(customerId, "Australia")).languages[0].languageConstant.id, "1000");
  await f.ads.createConversion({ customerId, name: "Booking" });
  const conversionRequest = JSON.parse(f.state.calls.at(-1).init.body).operations[0].create;
  assert.equal(conversionRequest.type, "WEBPAGE"); assert.equal(conversionRequest.countingType, "ONE_PER_CLICK");
  const preview = await f.ads.preview();
  assert.equal(JSON.parse(f.state.calls.at(-1).init.body).validateOnly, true);
  assert.deepEqual(await f.ads.create(preview.reviewId), { campaignId: "33", status: "PAUSED" });
  const batch = JSON.parse(f.state.calls.at(-1).init.body);
  assert.equal(batch.validateOnly, false); assert.equal(batch.partialFailure, false);
  assert.equal(batch.mutateOperations[1].campaignOperation.create.status, "PAUSED");
  assert.equal(batch.mutateOperations[1].campaignOperation.create.networkSettings.targetContentNetwork, false);
  assert.equal(batch.mutateOperations[0].campaignBudgetOperation.create.amountMicros, "12000000");
  assert.deepEqual(batch.mutateOperations.find(x => x.customConversionGoalOperation).customConversionGoalOperation.create.conversionActions, [`customers/${customerId}/conversionActions/22`]);
  const inspection = await f.ads.campaign("33");
  await assert.rejects(f.ads.launch({ campaignId: "33", reviewId: inspection.reviewId, trackingConfirmed: false, billingConfirmed: true }));
  assert.equal(f.live.campaign.status, "PAUSED");
  await f.ads.launch({ campaignId: "33", reviewId: inspection.reviewId, trackingConfirmed: true, billingConfirmed: true });
  assert.equal(f.live.campaign.status, "ENABLED");
  await f.ads.pause("33"); assert.equal(f.live.campaign.status, "PAUSED");
  assert.equal((await f.ads.report()).campaigns[0].campaign.id, "33");
  const before = f.state.grants;
  f.configuration.extensions.googleAdsSearch.ads.headlines[0] = "Fresh Booking Copy";
  const restarted = createConnectionService({ ...f.options, configuration: f.configuration });
  assert.equal((await restarted.status(input)).status, "connected");
  assert.equal(f.state.grants, before, "campaign changes do not require fresh OAuth consent");
});

test("Search rejects stale plans and live budgets, unsupported campaigns and denied writes without automatic retries", async t => {
  const f = await searchFixture(t); const preview = await f.ads.preview();
  f.configuration.extensions.googleAdsSearch.ads.dailyBudgetMicros = "13000000";
  await assert.rejects(f.ads.create(preview.reviewId), /changed/);
  assert.equal(f.state.calls.filter(call => call.url.pathname.endsWith("googleAds:mutate") && !JSON.parse(call.init.body).validateOnly).length, 0);
  let checked = await f.ads.campaign("33"); f.live.campaignBudget.amountMicros = "99000000";
  await assert.rejects(f.ads.launch({ campaignId: "33", reviewId: checked.reviewId, trackingConfirmed: true, billingConfirmed: true }), /changed/);
  f.live.campaign.biddingStrategyType = "MAXIMIZE_CONVERSIONS"; checked = await f.ads.campaign("33");
  await assert.rejects(f.ads.launch({ campaignId: "33", reviewId: checked.reviewId, trackingConfirmed: true, billingConfirmed: true }), /manual CPC/);
  f.state.status = 500; const calls = f.state.calls.length;
  await assert.rejects(f.ads.pause("33"), { code: "connector_provider_failed" });
  assert.equal(f.state.calls.length, calls + 1);
  f.state.status = 200; f.state.deny = true; const deniedCalls = f.state.calls.length;
  await assert.rejects(f.ads.pause("33")); assert.equal(f.state.calls.length, deniedCalls);
});

test("Search application command fragment reuses the native service and emits bounded display results", async t => {
  const f = await searchFixture(t);
  const request = { protocol: "vibe64.integration-setup.command.v1", requestId: "ads-fixture", operation: "ads-preview", ads: {} };
  const reply = await dispatchAdsSetup(request, f.ads);
  assert.equal(reply.status, "ads"); assert.equal(reply.operation, "ads-preview"); assert.equal(reply.data.plan.name, searchPlan.name);
  assert.equal(JSON.stringify(reply).includes("access-fixture"), false);
  await assert.rejects(dispatchAdsSetup({ ...request, operation: "ads-arbitrary" }, f.ads));
});
