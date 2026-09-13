import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { aiCatalogue, aiDefinition, DEFAULT_AI_MODEL, getAiModel, listAiModels } from "../src/shared/ai.js";
import { createAiConnectionResolver } from "../src/server/ai.js";
import { createEnvironmentReferenceResolver } from "../../connectors-core/src/server/environmentReferences.js";
import { parseIntegrationConfiguration, validateIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";

const configuration = (patch = {}) => ({ schemaVersion: 1, registrations: {}, integrations: {
  suggestions: { provider: "ai", accountMode: "shared", scopes: [], authentication: { method: "none" }, ...patch }
} });
const actor = { applicationId: "dogandgroom", subjectId: "customer-one" };
const request = { context: actor, integrationId: "suggestions" };
const authorize = async (context) => context?.applicationId === actor.applicationId ? context : null;
const validate = (config) => validateIntegrationConfiguration(config, { providers: [aiDefinition] });

test("AI preserves the upstream snapshot, exposes every provider and separates deprecated models", () => {
  assert.equal(aiCatalogue.extractedAt, "2026-09-10");
  assert.equal(aiCatalogue.providers.length, 213);
  assert.equal(listAiModels({ includeDeprecated: true }).length, 7614);
  assert.match(aiCatalogue.sourceSha256, /^[a-f0-9]{64}$/u);
  assert.equal(getAiModel("opencode/grok-code").status, "deprecated");
  assert.equal(listAiModels().some((model) => model.key === "opencode/grok-code"), false);
  assert.equal(aiCatalogue.providers.find((provider) => provider.id === "amazon-bedrock").connection, "framework");
});

test("AI lists every active Zen public model first and uses Big Pickle as the explicit default", () => {
  assert.equal(listAiModels()[0].key, DEFAULT_AI_MODEL);
  assert.deepEqual(listAiModels({ access: "free-no-setup" }).map((model) => model.id).sort(), [
    "big-pickle", "ling-3.0-flash-fin-free", "mimo-v2.5-free", "muse-spark-1.2-contributor-free",
    "muse-spark-1.3-contributor-free", "nemotron-3-ultra-free", "nemotron-3.5-lightning-free"
  ].sort());
  assert.equal(getAiModel("zai/glm-4.7-flash").access, "free-with-connection");
  assert.equal(getAiModel("zai/glm-4.7").access, "paid");
  for (const model of listAiModels({ access: "free-no-setup" })) {
    assert.equal(model.providerId, "opencode"); assert.equal(model.cost.input, 0); assert.equal(model.cost.output, 0);
    assert.ok(Object.values(model.cost).every((value) => value === 0));
  }
});

test("AI JSON defaults agree with the form and preserve explicit free model choices", () => {
  const config = validate(configuration());
  assert.deepEqual(config.integrations.suggestions.settings, { model: "opencode/big-pickle" });
  assert.deepEqual(config.integrations.suggestions.authentication, { method: "none" });
  config.integrations.suggestions.settings.model = "opencode/mimo-v2.5-free";
  assert.deepEqual(parseIntegrationConfiguration(JSON.stringify(config), { providers: [aiDefinition] }), config);
  assert.equal(JSON.stringify(config).includes("public"), false);
});

test("AI refuses missing models, deprecated models, coding subscriptions and unsupported cloud setup", () => {
  for (const model of ["opencode/removed", "opencode/grok-code", "zai-coding-plan/glm-4.7", "amazon-bedrock/anthropic.claude-v2", "constructor"]) {
    assert.throws(() => validate(configuration({ settings: { model } })), { code: "integration_configuration_invalid" });
  }
  for (const model of ["zai/glm-4.7-flash", "zai/glm-4.7", "openai/gpt-5.4"]) {
    assert.throws(() => validate(configuration({ settings: { model } })), (error) => {
      assert.ok(error.fieldErrors["integrations.suggestions.authentication.method"]); return true;
    });
  }
  for (const authentication of [{ method: "none", secretRef: "env:KEY" }, { method: "api-key", secretRef: "raw-key" },
    { method: "oauth2", registrationRef: "codex" }]) {
    assert.throws(() => validate(configuration({ authentication })), { code: "integration_configuration_invalid" });
  }
});

test("AI resolves no-account SDK parameters without environment, network or an OpenCode runtime", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Network is forbidden in this resolver."); });
  const resolver = createAiConnectionResolver({ configuration: configuration(), authorize,
    resolveReference: () => { throw new Error("Free mode must not resolve credentials."); } });
  assert.deepEqual(await resolver.resolve(request), { providerId: "opencode", model: "big-pickle",
    sdkPackage: "@ai-sdk/openai-compatible", baseURL: "https://opencode.ai/zen/v1", apiKey: "public", access: "free-no-setup" });
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.equal(Object.hasOwn(resolver, "invoke"), false);
});

test("AI preserves model-specific SDK protocols including Zen Responses models", async () => {
  const resolver = createAiConnectionResolver({ configuration: configuration({ settings: { model: "opencode/muse-spark-1.3-contributor-free" } }), authorize });
  const result = await resolver.resolve(request);
  assert.equal(result.sdkPackage, "@ai-sdk/openai"); assert.equal(result.model, "muse-spark-1.3-contributor-free");
  assert.equal(result.baseURL, "https://opencode.ai/zen/v1");
});

test("AI shares the administrator's Env key only after application authorization and observes rotation", async () => {
  const env = { APP_AI_API_KEY: "fixture-key-one" }; const decisions = [];
  const resolver = createAiConnectionResolver({ configuration: configuration({ settings: { model: "zai/glm-4.7-flash" },
    authentication: { method: "api-key", secretRef: "env:APP_AI_API_KEY" } }),
  authorize: async (context, operation) => { decisions.push(operation); return authorize(context); },
  resolveReference: createEnvironmentReferenceResolver(env) });
  assert.equal((await resolver.resolve(request)).apiKey, "fixture-key-one"); env.APP_AI_API_KEY = "fixture-key-two";
  const connection = await resolver.resolve({ ...request, context: { ...actor, subjectId: "customer-two" } });
  assert.equal(connection.apiKey, "fixture-key-two"); assert.equal(connection.baseURL, "https://api.z.ai/api/paas/v4");
  assert.equal(connection.model, "glm-4.7-flash");
  assert.deepEqual(decisions[0], { integrationId: "suggestions", operation: "ai.resolve", accountMode: "shared" });
  delete env.APP_AI_API_KEY;
  await assert.rejects(resolver.resolve(request), { code: "connector_binding_missing" });
});

test("AI keeps individual account resolution scoped to the authorized app user and provider", async () => {
  const keys = new Map([["customer-one", "user-one-key"], ["customer-two", "user-two-key"]]);
  const config = configuration({ accountMode: "per-user", settings: { model: "zai/glm-4.7-flash" },
    authentication: { method: "api-key", secretRef: "account:ai-key" } });
  const resolver = createAiConnectionResolver({ configuration: config, authorize, resolveReference: async (ref, owner, slot) => {
    assert.equal(ref, "account:ai-key"); assert.equal(owner.applicationId, actor.applicationId);
    assert.deepEqual(slot, { integrationId: "suggestions", accountMode: "per-user", providerId: "zai" });
    return keys.get(owner.subjectId);
  } });
  assert.equal((await resolver.resolve(request)).apiKey, "user-one-key");
  assert.equal((await resolver.resolve({ ...request, context: { ...actor, subjectId: "customer-two" } })).apiKey, "user-two-key");
  keys.delete("customer-one");
  await assert.rejects(resolver.resolve(request), { code: "connector_binding_missing" });
  assert.equal((await resolver.resolve({ ...request, context: { ...actor, subjectId: "customer-two" } })).apiKey, "user-two-key");
  config.integrations.suggestions.authentication.secretRef = "env:SHARED_KEY";
  await assert.rejects(createAiConnectionResolver({ configuration: config, authorize }).resolve(request), { code: "connector_binding_invalid" });
});

test("AI denies unauthorized subjects before looking up credentials and redacts binding errors", async () => {
  let lookups = 0;
  const config = configuration({ settings: { model: "openai/gpt-5.4" }, authentication: { method: "api-key", secretRef: "env:KEY" } });
  const resolver = createAiConnectionResolver({ configuration: config, authorize, resolveReference: () => {
    lookups++; throw new Error("private-provider-token");
  } });
  for (const context of [null, {}, { ...actor, applicationId: "another-app" }]) {
    await assert.rejects(resolver.resolve({ ...request, context }), { code: "connector_access_denied" });
  }
  assert.equal(lookups, 0);
  await assert.rejects(resolver.resolve({ ...request, integrationId: "constructor" }), { code: "connector_not_found" });
  await assert.rejects(resolver.resolve(request), (error) => error.code === "connector_binding_missing" && !String(error).includes("private-provider-token"));
});

test("AI can hand parameters to an app-owned SDK without making that SDK a dependency", async () => {
  const result = await createAiConnectionResolver({ configuration: configuration(), authorize }).resolve(request);
  // A controlled SDK factory fixture; no generated application or inference call.
  const createProvider = (options) => ({ model: (id) => ({ endpoint: options.baseURL, id }) });
  assert.deepEqual(createProvider(result).model(result.model), { endpoint: "https://opencode.ai/zen/v1", id: "big-pickle" });
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(Object.keys(pkg.dependencies).some((name) => name.startsWith("@ai-sdk/") || name.includes("opencode")), false);
});
