import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { posthogProvider } from "../src/server/posthog.js";

const context = { applicationId: "app-one", subjectId: "analytics-team" };
const input = { context, integrationId: "analytics" };
const verificationInput = { distinct_id: "explicit-user" };
const flags = { flags: { checkout: { key: "checkout", enabled: true, variant: "control",
  reason: { code: "condition_match" }, metadata: { id: 10, version: 1, payload: { colour: "blue" } } } },
errorsWhileComputingFlags: false, requestId: "fixture-request" };

async function fixture(t, region = "eu") {
  const directory = await mkdtemp(path.join(tmpdir(), "posthog-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(9) }, activeKeyId: "current" });
  const requests = [];
  const state = { token: "phc_fixture_public_token", status: 200, response: flags };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { analytics: {
      provider: "posthog", accountMode: "shared", scopes: [],
      authentication: { method: "api-key", secretRef: "env:POSTHOG_PROJECT_TOKEN" },
      settings: { region, projectId: "12345" }, extensions: { fromCli: true }
    } } },
    providers: [posthogProvider], authorize: async (owner) => owner,
    store: createFileConnectionStore({ directory, protection }),
    resolveReference: async (reference) => { assert.equal(reference, "env:POSTHOG_PROJECT_TOKEN"); return state.token; },
    fetchImpl: async (address, init) => {
      requests.push({ url: new URL(String(address)), init, headers: new Headers(init.headers), body: JSON.parse(init.body) });
      return Response.json(state.response, { status: state.status });
    }
  };
  return { service: createConnectionService(options), options, requests, directory, protection, state };
}

for (const region of ["eu", "us"]) {
  test(`PostHog verifies flags in ${region} and retains file ownership across restart and token rotation`, async (t) => {
    assert.deepEqual(posthogProvider.verificationFields.filter((field) => field.required).map((field) => field.name), Object.keys(verificationInput));
    const { service, options, requests, directory, protection, state } = await fixture(t, region);
    const connected = await service.connectApiKey({ ...input, verificationInput });
    assert.equal(connected.status, "connected");
    const first = requests[0];
    assert.equal(first.url.href, `https://${region}.i.posthog.com/flags?v=2`);
    assert.equal(first.init.method, "POST");
    assert.equal(first.init.redirect, "error");
    assert.equal(first.headers.get("content-type"), "application/json");
    assert.equal(first.headers.has("authorization"), false);
    assert.match(first.headers.get("user-agent"), /^jskit-connectors\/.+posthog-node\//u);
    assert.deepEqual(first.body, { ...verificationInput, api_key: state.token });
    for (const name of await readdir(directory)) {
      const stored = await readFile(path.join(directory, name), "utf8");
      assert.doesNotThrow(() => JSON.parse(stored));
      assert.equal(stored.includes(state.token), false);
      assert.equal(stored.includes(verificationInput.distinct_id), false);
    }
    const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
    assert.deepEqual(await restarted.status(input), connected);
    state.token = "phc_rotated_public_token";
    assert.deepEqual(await restarted.invoke({ ...input, operation: "flags.evaluate", input: verificationInput }), flags);
    assert.equal(requests.at(-1).body.api_key, state.token);
    for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-team" }]) {
      await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "flags.evaluate", input: verificationInput }), { code: "connector_reconnect_required" });
    }
    assert.equal(requests.length, 2);
    await restarted.disconnect(input);
    assert.equal((await service.status(input)).status, "disconnected");
  });
}

test("PostHog validates project identity and region using the same portable schema as its form", async (t) => {
  const { options, requests } = await fixture(t);
  const parse = (configuration) => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [posthogProvider] });
  const configuration = structuredClone(options.configuration);
  delete configuration.integrations.analytics.settings.region;
  assert.deepEqual(parse(configuration), options.configuration);
  for (const projectId of [undefined, "", "abc", "-1", "0", "1.2", "1".repeat(21)]) {
    configuration.integrations.analytics.settings.projectId = projectId;
    assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors["integrations.analytics.settings.projectId"]));
  }
  configuration.integrations.analytics.settings = { region: "attacker.invalid", projectId: "12345" };
  assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors["integrations.analytics.settings.region"]));
  configuration.integrations.analytics.settings.region = "eu";
  configuration.integrations.analytics.authentication.secretRef = "phc_raw_project_token";
  assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors["integrations.analytics.authentication.secretRef"]));
  assert.equal(requests.length, 0);
});

test("PostHog never invents a verification subject or substitutes private analytics credentials", async (t) => {
  const { service, requests, state } = await fixture(t);
  for (const invalid of [undefined, {}, { distinct_id: "" }, { distinct_id: "x".repeat(201) }, { distinct_id: "user", api_key: "phc_other" }]) {
    await assert.rejects(service.connectApiKey({ ...input, verificationInput: invalid }), { code: "connector_input_invalid" });
  }
  for (const token of ["phx_personal_token", "phs_project_secret", "pha_oauth_token", "phr_refresh_token", "phc_", "phc_bad\nheader"]) {
    state.token = token;
    await assert.rejects(service.connectApiKey({ ...input, verificationInput }), { code: "connector_binding_missing" });
  }
  assert.deepEqual(await service.status(input), { status: "unconfigured", configurationError: "connector_binding_missing" });
  state.token = "phc_valid_project_token";
  assert.equal(requests.length, 0);
  assert.equal((await service.status(input)).status, "disconnected");
});

test("PostHog requires re-verification after project or region changes and blocks other API origins", async (t) => {
  const { service, options, requests } = await fixture(t);
  await service.connectApiKey({ ...input, verificationInput });
  for (const [field, value] of [["projectId", "999"], ["region", "us"]]) {
    const configuration = structuredClone(options.configuration);
    configuration.integrations.analytics.settings[field] = value;
    const changed = createConnectionService({ ...options, configuration });
    assert.equal((await changed.status(input)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...input, operation: "flags.evaluate", input: verificationInput }), { code: "connector_reconnect_required" });
  }
  for (const origin of ["https://us.i.posthog.com", "https://eu.posthog.com", "https://attacker.invalid"]) {
    const wrongHost = createConnectionService({ ...options, providers: [{ ...posthogProvider, operations: {
      "flags.evaluate": { scopes: [], request: () => ({ method: "POST", url: `${origin}/flags?v=2`, body: verificationInput }) }
    } }] });
    await assert.rejects(wrongHost.invoke({ ...input, operation: "flags.evaluate", input: verificationInput }), { code: "connector_destination_invalid" });
  }
  assert.equal(requests.length, 1);
});

test("PostHog preserves flag metadata and subject properties without accepting credential or URL overrides", async (t) => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey({ ...input, verificationInput });
  const values = { distinct_id: "user+&=42", groups: { company: "company-42" }, person_properties: { plan: "paid", enabled: false } };
  assert.deepEqual(await service.invoke({ ...input, operation: "flags.evaluate", input: values }), flags);
  assert.deepEqual(requests.at(-1).body, { ...values, api_key: state.token });
  assert.equal(requests.at(-1).url.search, "?v=2");
  assert.equal(Object.hasOwn(values, "api_key"), false);
  for (const invalid of [{ ...values, api_key: "phc_other" }, { ...values, url: "https://attacker.invalid" }, { ...values, groups: [] }, { ...values, person_properties: "plan=paid" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "flags.evaluate", input: invalid }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, 2);
  state.response = { flags: {}, errorsWhileComputingFlags: false };
  assert.deepEqual(await service.invoke({ ...input, operation: "flags.evaluate", input: values }), state.response);
});

test("PostHog HTTP-200 flag quota and partial failures never imply a usable verified connection", async (t) => {
  const { service, state } = await fixture(t);
  for (const [response, code] of [
    [{ flags: {}, errorsWhileComputingFlags: false, quotaLimited: ["feature_flags"] }, "connector_quota_limited"],
    [{ ...flags, errorsWhileComputingFlags: true }, "connector_provider_failed"],
    [{ flags: {} }, "connector_response_invalid"],
    [{ ...flags, flags: [] }, "connector_response_invalid"],
    [{ ...flags, quotaLimited: "feature_flags" }, "connector_response_invalid"],
    [{ ...flags, flags: { checkout: { enabled: "yes" } } }, "connector_response_invalid"],
    [{ ...flags, flags: { checkout: { enabled: true, variant: {} } } }, "connector_response_invalid"]
  ]) {
    state.response = response;
    await assert.rejects(service.connectApiKey({ ...input, verificationInput }), { code });
    assert.equal((await service.status(input)).status, "disconnected");
  }
});

test("PostHog capture is an explicit separate operation and preserves acceptance and quota information", async (t) => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey({ ...input, verificationInput });
  state.response = { status: "Ok", quota_limited: ["events"] };
  const values = { event: "checkout_completed", distinct_id: "user-one", properties: { value: 19, currency: "EUR" } };
  assert.deepEqual(await service.invoke({ ...input, operation: "events.capture", input: values }), state.response);
  assert.equal(requests.at(-1).url.href, "https://eu.i.posthog.com/i/v0/e/");
  assert.deepEqual(requests.at(-1).body, { ...values, api_key: state.token });
  for (const invalid of [{ ...values, event: "" }, { event: "checkout" }, { ...values, api_key: "phc_other" }, { ...values, properties: { token: "phc_other" } }, { ...values, properties: { distinct_id: "other-user" } }]) {
    await assert.rejects(service.invoke({ ...input, operation: "events.capture", input: invalid }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, 2);
  state.response = { status: "Ok" };
  await service.invoke({ ...input, operation: "events.capture", input: { event: "page_opened", distinct_id: "user-one" } });
  assert.deepEqual(requests.at(-1).body.properties, {});
  for (const malformed of [{}, { status: "Error" }, { status: "Ok", quota_limited: "events" }]) {
    state.response = malformed;
    await assert.rejects(service.invoke({ ...input, operation: "events.capture", input: values }), { code: "connector_response_invalid" });
  }
});

test("PostHog rejects HTTP failures without leaking response bodies and marks a rejected token for reconnection", async (t) => {
  const { service, state } = await fixture(t);
  for (const [status, code] of [[401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status;
    state.response = { detail: state.token };
    await assert.rejects(service.connectApiKey({ ...input, verificationInput }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes(state.token), false);
      assert.equal(JSON.stringify(error).includes(state.token), false);
      return true;
    });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  state.status = 200;
  state.response = flags;
  await service.connectApiKey({ ...input, verificationInput });
  state.status = 401;
  await assert.rejects(service.invoke({ ...input, operation: "flags.evaluate", input: verificationInput }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});
