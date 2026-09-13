import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSchema } from "json-rest-schema";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { createConnectionService, createConnectorsFeature } from "../src/server/index.js";
import { ConnectorError } from "../src/server/errors.js";
import { createFileConnectionStore, createCredentialProtection } from "../src/server/fileStorage.js";
import { validateIntegrationConfiguration } from "../src/shared/configuration.js";

const context = { applicationId: "application", subjectId: "team" };
const input = { context, integrationId: "notifications" };
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "service-account-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = { now: 1_800_000_000_000, credential: '{\n "type": "service_account", "private_key": "fixture-key"\n}',
    grants: [], requests: [], failGrant: false, status: 200, response: { ok: true }, resolutions: 0 };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { notifications: {
      provider: "service-fixture", accountMode: "shared", scopes: ["send"],
      authentication: { method: "service-account", secretRef: "env:SERVICE_ACCOUNT" }, settings: { projectId: "project-1" }
    } } },
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(5) }, activeKeyId: "current" }) }),
    now: () => state.now, authorize: async (owner) => owner,
    resolveReference: async () => { state.resolutions++; return state.credential; },
    fetchImpl: async (url, init) => {
      init.signal.throwIfAborted();
      state.requests.push({ url, init });
      return Response.json(state.response, { status: state.status });
    },
    providers: [{ id: "service-fixture", accountModes: ["shared", "assistant"], authenticationMethods: ["service-account"], scopes: [{ value: "send" }, { value: "read" }],
      settingsSchema: createSchema({ projectId: { type: "string", required: true } }),
      apiOrigins: ["https://messages.example"], checkOperation: "check", requestTimeoutMs: 50,
      operations: { check: { scopes: ["send"], request(values, settings) { return { url: `https://messages.example/${settings.projectId}`, method: "POST", body: values }; }, validateResult: (value) => value?.ok === true } },
      async serviceAccountGrant(request) {
        state.grants.push(request);
        if (state.hang) {
          state.started?.();
          await new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true }));
        }
        if (state.failGrant) throw new ConnectorError("connector_reconnect_required", "Reconnect this account.", { statusCode: 401 });
        return state.tokenResponse || { access_token: `fixture-token-${state.grants.length}`, token_type: "Bearer", expires_in: 3600 };
      }
    }]
  };
  return { state, options, directory, service: createConnectionService(options) };
}

test("service-account configuration requires an indirect credential, declared mode, scopes and shared ownership", async (t) => {
  const f = await fixture(t);
  const validate = (config, providers = f.options.providers) => validateIntegrationConfiguration(config, { providers });
  assert.deepEqual(validate(f.options.configuration), f.options.configuration);
  for (const change of [
    { authentication: { method: "service-account" } },
    { authentication: { method: "service-account", secretRef: f.state.credential } },
    { authentication: { method: "service-account", secretRef: "env:KEY", registrationRef: "unused" } },
    { accountMode: "per-user" }, { scopes: [] }, { scopes: ["admin"] }, { scopes: ["send", "send"] }
  ]) {
    const config = structuredClone(f.options.configuration); Object.assign(config.integrations.notifications, change);
    assert.throws(() => validate(config), { code: "integration_configuration_invalid" });
  }
  assert.throws(() => validate(f.options.configuration, [{ ...f.options.providers[0], authenticationMethods: ["api-key"] }]), { code: "integration_configuration_invalid" });
  // Even a mistaken provider declaration cannot turn service credentials into end-user identity.
  const personal = structuredClone(f.options.configuration); personal.integrations.notifications.accountMode = "per-user";
  assert.throws(() => validate(personal, [{ ...f.options.providers[0], accountModes: ["per-user"] }]), { code: "integration_configuration_invalid" });
  assert.equal(f.state.resolutions, 0);
});

test("service credentials obtain a verified grant once, persist encrypted tokens and reuse them after restart", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.invoke({ ...input, operation: "check" }), { code: "connector_reconnect_required" });
  const connected = await f.service.connectServiceAccount(input);
  assert.deepEqual(connected, { provider: "service-fixture", integrationId: "notifications", status: "connected", grantedScopes: ["send"], verifiedAt: f.state.now });
  assert.equal(f.state.grants.length, 1);
  const grant = f.state.grants[0];
  assert.equal(grant.credential, f.state.credential); assert.equal(grant.fetchImpl, f.options.fetchImpl);
  assert.deepEqual(grant.settings, { projectId: "project-1" }); assert.deepEqual(grant.scopes, ["send"]); assert.equal(grant.now, f.state.now);
  const restarted = createConnectionService(f.options);
  assert.deepEqual(await restarted.status(input), connected);
  await restarted.invoke({ ...input, operation: "check", input: { check: "again" } });
  assert.equal(f.state.grants.length, 1);
  assert.equal(new Headers(f.state.requests.at(-1).init.headers).get("authorization"), "Bearer fixture-token-1");
  for (const file of await readdir(f.directory)) {
    const text = await readFile(path.join(f.directory, file), "utf8");
    for (const secret of ["fixture-key", "fixture-token-1", "credentialFingerprint"]) assert(!text.includes(secret));
  }
  await f.options.store.withConnection({ owner: context, integrationId: input.integrationId }, async ({ connection }) => {
    assert.equal(connection.tokens.refreshToken, null); assert.match(connection.credentialFingerprint, /^[a-f0-9]{64}$/u);
    assert(!JSON.stringify(connection).includes("fixture-key"));
  });
  await restarted.disconnect(input); assert.equal((await f.service.status(input)).status, "disconnected");
});

test("expiry renews once under the file lock across independent service instances", async (t) => {
  const f = await fixture(t); await f.service.connectServiceAccount(input);
  f.state.now += 3_571_000;
  const second = createConnectionService({ ...f.options, store: createFileConnectionStore({ directory: f.directory,
    protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(5) }, activeKeyId: "current" }) }) });
  await Promise.all([f.service, second, f.service].map((service) => service.invoke({ ...input, operation: "check" })));
  assert.equal(f.state.grants.length, 2);
  for (const request of f.state.requests.slice(1)) assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer fixture-token-2");
});

test("rotating the bound credential renews before the next API request and never persists the credential", async (t) => {
  const f = await fixture(t); await f.service.connectServiceAccount(input);
  f.state.credential = '{"private_key":"rotated-fixture-key"}';
  await f.service.invoke({ ...input, operation: "check" });
  assert.equal(f.state.grants.length, 2); assert.equal(f.state.grants[1].credential, f.state.credential);
  await f.service.invoke({ ...input, operation: "check" }); assert.equal(f.state.grants.length, 2);
  await f.options.store.withConnection({ owner: context, integrationId: input.integrationId }, async ({ connection }) => {
    assert(!JSON.stringify(connection).includes("rotated-fixture-key"));
  });
});

test("ownership and changed reference, project or requested scopes cannot reuse another grant", async (t) => {
  const f = await fixture(t); await f.service.connectServiceAccount(input);
  for (const owner of [{ ...context, applicationId: "other" }, { ...context, subjectId: "other" }]) {
    await assert.rejects(f.service.invoke({ ...input, context: owner, operation: "check" }), { code: "connector_reconnect_required" });
  }
  for (const change of [{ settings: { projectId: "project-2" } }, { scopes: ["send", "read"] }, { authentication: { method: "service-account", secretRef: "env:OTHER" } }]) {
    const configuration = structuredClone(f.options.configuration); Object.assign(configuration.integrations.notifications, change);
    const changed = createConnectionService({ ...f.options, configuration });
    assert.equal((await changed.status(input)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...input, operation: "check" }), { code: "connector_reconnect_required" });
  }
  assert.equal(f.state.requests.length, 1); assert.equal(f.state.grants.length, 1);
});

test("failed verification and reduced provider grants never create a connected record", async (t) => {
  const f = await fixture(t);
  f.state.response = { ok: false };
  await assert.rejects(f.service.connectServiceAccount(input), { code: "connector_response_invalid" });
  assert.equal((await f.service.status(input)).status, "disconnected");
  f.state.tokenResponse = { access_token: "token", token_type: "Bearer", expires_in: 3600, scope: "read admin" };
  await assert.rejects(f.service.connectServiceAccount(input), { code: "connector_scope_missing" });
  assert.equal(f.state.requests.length, 1); assert.equal((await f.service.status(input)).status, "disconnected");
});

test("renewed tokens survive a subsequent provider failure and authorization failures require reconnect", async (t) => {
  const f = await fixture(t); await f.service.connectServiceAccount(input); f.state.now += 3_600_000;
  f.state.status = 429;
  await assert.rejects(f.service.invoke({ ...input, operation: "check" }), { code: "connector_rate_limited" });
  f.state.status = 200;
  await createConnectionService(f.options).invoke({ ...input, operation: "check" }); assert.equal(f.state.grants.length, 2);
  f.state.credential = "rotated"; f.state.failGrant = true; const before = f.state.requests.length;
  await assert.rejects(f.service.invoke({ ...input, operation: "check" }), { code: "connector_reconnect_required" });
  assert.equal(f.state.requests.length, before); assert.equal((await f.service.status(input)).status, "reconnect-required");
});

test("malformed token responses and missing bindings do not expose provider values or create connections", async (t) => {
  const f = await fixture(t);
  for (const credential of [undefined, {}, "", "\0bad", "x".repeat(65_537)]) {
    f.state.credential = credential;
    await assert.rejects(f.service.connectServiceAccount(input), { code: "connector_binding_missing" });
  }
  assert.equal(f.state.grants.length, 0); f.state.credential = "fixture-key";
  const valid = { access_token: "private-token", token_type: "Bearer", expires_in: 3600 };
  for (const change of [{ access_token: "" }, { access_token: "token\nvalue" }, { token_type: "Basic" }, { token_type: null },
    { expires_in: "3600" }, { expires_in: 0 }, { expires_in: NaN }, { expires_in: 86_401 }, { refresh_token: "private-refresh" }, { scope: [] }]) {
    f.state.tokenResponse = { ...valid, ...change };
    await assert.rejects(f.service.connectServiceAccount(input), (error) => error.code === "connector_response_invalid" && !JSON.stringify(error).includes("private-"));
  }
  assert.equal(f.state.requests.length, 0); assert.equal((await f.service.status(input)).status, "disconnected");
});

test("service grants honor cancellation and deadlines without replay or partial connection state", async (t) => {
  const f = await fixture(t); f.state.hang = true;
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(f.service.connectServiceAccount({ ...input, signal: cancelled.signal }), { code: "connector_cancelled" });
  assert.equal(f.state.grants.length, 0);
  const active = new AbortController(); const started = new Promise((resolve) => { f.state.started = resolve; });
  const pending = f.service.connectServiceAccount({ ...input, signal: active.signal }); await started; active.abort();
  await assert.rejects(pending, { code: "connector_cancelled" });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(f.service.connectServiceAccount(input), { code: "connector_provider_timeout" }); } finally { clearTimeout(keepAlive); }
  assert.equal(f.state.grants.length, 2); assert.equal(f.state.requests.length, 0);
  assert.equal((await f.service.status(input)).status, "disconnected");
});

test("the service-account Feature action uses the same application policy and verified runtime", async (t) => {
  const f = await fixture(t); let actions;
  const runtime = createCapabilityRuntime({ providers: [createActionProvider(), createConnectorsFeature(f.options),
    defineProvider({ id: "test.service-observer", requires: { catalogue: "runtime.actions" }, setup({ catalogue }) { actions = catalogue; } })] });
  await runtime.start();
  try {
    const result = await actions.execute({ actionId: "connectors.verifyServiceAccount", input: { integrationId: input.integrationId }, context: { ...context, channel: "api", surface: "app" } });
    assert.equal(result.status, "connected"); assert.equal((await f.service.status(input)).status, "connected");
  } finally { await runtime.shutdown(); }
});
