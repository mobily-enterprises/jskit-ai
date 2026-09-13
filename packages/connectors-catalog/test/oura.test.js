import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { ouraProvider } from "../src/server/oura.js";

const callback = "https://app.example.test/oura/callback";
const context = { applicationId: "app-one", subjectId: "user-one" };
const input = { context, integrationId: "oura" };
const daily = { data: [{ id: "sleep-1", day: "2026-09-01", score: 82 }], next_token: "next +&2" };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "oura-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const state = { time: Date.now(), tokenCount: 0, tokenScope: undefined, status: 200, response: daily };
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(6) }, activeKeyId: "current" });
  const options = {
    configuration: { schemaVersion: 1, integrations: {
      oura: { provider: "oura", accountMode: "per-user", scopes: ["daily", "personal", "email"], authentication: { method: "oauth2", registrationRef: "oura" } }
    }, registrations: { oura: { source: "own", clientId: "fixture-client", clientSecretRef: "env:OURA_SECRET", callbackUrlRef: "env:OURA_CALLBACK" } } },
    providers: [ouraProvider], authorize: async (owner) => owner, now: () => state.time,
    resolveReference: async (ref) => ref === "env:OURA_CALLBACK" ? callback : "fixture-client-secret",
    store: createFileConnectionStore({ directory, protection }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address));
      requests.push({ url, init, headers: new Headers(init.headers) });
      assert.equal(url.origin, "https://api.ouraring.com");
      if (url.pathname === "/oauth/token") {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), "fixture-client");
        assert.equal(body.get("client_secret"), "fixture-client-secret");
        if (body.get("grant_type") === "refresh_token") assert.equal(body.get("refresh_token"), `fixture-refresh-${state.tokenCount}`);
        state.tokenCount += 1;
        return Response.json({ access_token: `fixture-access-${state.tokenCount}`, refresh_token: `fixture-refresh-${state.tokenCount}`, token_type: "bearer", expires_in: 60,
          ...(state.tokenScope === undefined ? {} : { scope: state.tokenScope }) });
      }
      return Response.json(state.response, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  async function start(scope = "daily personal") {
    const { authorizationUrl } = await service.beginAuthorization(input);
    const url = new URL(authorizationUrl);
    const redirect = new URL(callback);
    redirect.searchParams.set("code", "fixture-code");
    redirect.searchParams.set("state", url.searchParams.get("state"));
    if (scope !== null) redirect.searchParams.set("scope", scope);
    return { url, callbackUrl: redirect.href };
  }
  return { service, options, protection, directory, requests, state, start };
}

test("Oura uses code consent, records reduced callback scopes and persists a private per-user grant", async (t) => {
  const { service, options, protection, directory, requests, state, start } = await fixture(t);
  const { url, callbackUrl } = await start();
  assert.equal(url.origin + url.pathname, "https://cloud.ouraring.com/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), callback);
  assert.equal(url.searchParams.get("scope"), "daily personal email");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.has("client_secret"), false);
  const connected = await service.completeAuthorization({ ...input, callbackUrl });
  assert.equal(connected.status, "connected");
  assert.deepEqual(connected.grantedScopes, ["daily", "personal"]);
  const code = new URLSearchParams(requests[0].init.body);
  assert.equal(code.get("grant_type"), "authorization_code");
  assert.equal(code.get("redirect_uri"), callback);
  assert.ok(code.get("code_verifier"));
  assert.equal(requests[1].url.pathname, "/v2/usercollection/daily_sleep");
  assert.equal(requests[1].headers.get("authorization"), "Bearer fixture-access-1");
  assert.equal(requests[1].init.redirect, "error");
  for (const name of await readdir(directory)) {
    const text = await readFile(path.join(directory, name), "utf8");
    for (const secret of ["fixture-client-secret", "fixture-access-1", "fixture-refresh-1"]) assert.equal(text.includes(secret), false);
  }
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.status(input), { ...connected, callbackUrl: callback });
  const operation = { ...input, operation: "dailySleep.list", input: { start_date: "2026-09-01", end_date: "2026-09-08", next_token: "next +&2" } };
  assert.deepEqual(await restarted.invoke(operation), daily);
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), operation.input);
  state.response = { id: "oura-person", age: null };
  assert.deepEqual(await restarted.invoke({ ...input, operation: "personalInfo.read" }), state.response);
  assert.equal(requests.at(-1).url.pathname, "/v2/usercollection/personal_info");
  for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-user" }]) {
    await assert.rejects(restarted.invoke({ ...operation, context: owner }), { code: "connector_reconnect_required" });
  }
  await restarted.disconnect(input);
  assert.equal((await service.status(input)).status, "disconnected");
});

test("Oura rejects cancelled, denied, missing or ambiguous consent and never restores declined scopes", async (t) => {
  const { service, requests, start } = await fixture(t);
  const cancelled = await start();
  await service.cancelAuthorization({ ...input, state: cancelled.url.searchParams.get("state") });
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: cancelled.callbackUrl }), { code: "connector_attempt_invalid" });
  for (const kind of ["missing", "duplicate", "denied"]) {
    const started = await start(kind === "missing" ? null : "daily");
    const url = new URL(started.callbackUrl);
    if (kind === "duplicate") url.searchParams.append("scope", "personal");
    if (kind === "denied") { url.searchParams.delete("code"); url.searchParams.set("error", "access_denied"); }
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: url.href }), {
      code: kind === "denied" ? "connector_consent_denied" : "connector_response_invalid"
    });
  }
  assert.equal(requests.length, 0);
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: (await start("email")).callbackUrl }), { code: "connector_scope_missing" });
  assert.equal(requests.length, 1);
  const connected = await service.completeAuthorization({ ...input, callbackUrl: (await start("daily unexpected")).callbackUrl });
  assert.deepEqual(connected.grantedScopes, ["daily"]);
  const count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "personalInfo.read" }), { code: "connector_scope_missing" });
  assert.equal(requests.length, count);
});

test("Oura serializes single-use refresh tokens and preserves reduced scopes after restart", async (t) => {
  const { service, options, state, start } = await fixture(t);
  await service.completeAuthorization({ ...input, callbackUrl: (await start("daily")).callbackUrl });
  state.time += 40_000;
  await Promise.all([service.invoke({ ...input, operation: "dailySleep.list" }), service.invoke({ ...input, operation: "dailySleep.list" })]);
  assert.equal(state.tokenCount, 2);
  const restarted = createConnectionService(options);
  state.time += 40_000;
  await restarted.invoke({ ...input, operation: "dailySleep.list" });
  assert.equal(state.tokenCount, 3);
  assert.deepEqual((await restarted.status(input)).grantedScopes, ["daily"]);
});

test("Oura provider errors and malformed successes remain disconnected and redact provider messages", async (t) => {
  const { service, state, start } = await fixture(t);
  for (const [status, code] of [[200, "connector_response_invalid"], [401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status;
    state.response = { message: "fixture-client-secret" };
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes("fixture-client-secret"), false);
      assert.equal(JSON.stringify(error).includes("fixture-client-secret"), false);
      return true;
    });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  state.status = 200;
  state.response = daily;
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  state.status = 401;
  await assert.rejects(service.invoke({ ...input, operation: "dailySleep.list" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Oura validates dates and opaque paging inputs before any provider request", async (t) => {
  const { service, requests, state, start } = await fixture(t);
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  const count = requests.length;
  for (const invalid of [
    { start_date: "2026-02-29" }, { end_date: "2026-09-31" }, { start_date: "2026-01-01T00:00:00Z" },
    { next_token: "" }, { next_token: "x".repeat(4097) }, { url: "https://attacker.invalid" }, { limit: 100 }
  ]) await assert.rejects(service.invoke({ ...input, operation: "dailySleep.list", input: invalid }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  state.response = { data: [], next_token: null };
  assert.deepEqual(await service.invoke({ ...input, operation: "dailySleep.list", input: { start_date: "2024-02-29" } }), state.response);
});

test("Oura prefers token-response permissions when present over the authorization callback fallback", async (t) => {
  const { service, state, start } = await fixture(t);
  state.tokenScope = "daily";
  const connected = await service.completeAuthorization({ ...input, callbackUrl: (await start("daily personal email")).callbackUrl });
  assert.deepEqual(connected.grantedScopes, ["daily"]);
  await assert.rejects(service.invoke({ ...input, operation: "personalInfo.read" }), { code: "connector_scope_missing" });
});


test("Oura rejects an empty permission selection before starting broad consent", async (t) => {
  const { options, requests } = await fixture(t);
  const configuration = structuredClone(options.configuration);
  configuration.integrations.oura.scopes = [];
  assert.throws(() => createConnectionService({ ...options, configuration }));
  assert.equal(requests.length, 0);
});

test("Oura reads sleep readiness activity and separately consented heart rate with explicit paging", async t => {
  const { options, state, requests } = await fixture(t);
  options.configuration.integrations.oura.scopes.push("heartrate");
  const expanded = createConnectionService(options);
  const { authorizationUrl } = await expanded.beginAuthorization(input);
  const cb = new URL(callback); cb.searchParams.set("state", new URL(authorizationUrl).searchParams.get("state")); cb.searchParams.set("code", "fixture-code"); cb.searchParams.set("scope", "daily heartrate");
  await expanded.completeAuthorization({ ...input, callbackUrl: cb.href });
  for (const [op, endpoint] of [["sleep.list", "sleep"], ["dailyReadiness.list", "daily_readiness"], ["dailyActivity.list", "daily_activity"]]) {
    state.response = { data: [{ id: endpoint, day: "2026-09-01", score: 85 }], next_token: "next+&2" };
    assert.deepEqual(await expanded.invoke({ ...input, operation: op, input: { start_date: "2026-09-01", end_date: "2026-09-02", next_token: "prior+&1" } }), state.response);
    assert.equal(requests.at(-1).url.pathname, `/v2/usercollection/${endpoint}`);
    assert.equal(requests.at(-1).url.searchParams.get("next_token"), "prior+&1");
  }
  state.response = { data: [{ bpm: 65, source: "sleep", timestamp: "2026-09-01T00:01:00+08:00" }], next_token: null };
  const values = { start_datetime: "2026-09-01T00:00:00+08:00", end_datetime: "2026-09-02T00:00:00+08:00" };
  assert.deepEqual(await expanded.invoke({ ...input, operation: "heartRate.list", input: values }), state.response);
  assert.equal(requests.at(-1).url.searchParams.get("start_datetime"), values.start_datetime);
  const count = requests.length;
  for (const invalid of [{ start_datetime: "2026-02-30T00:00:00Z" }, { start_datetime: "2026-09-01T00:00:00" }, { ...values, end_datetime: "2026-08-01T00:00:00Z" }])
    await assert.rejects(expanded.invoke({ ...input, operation: "heartRate.list", input: invalid }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  await expanded.disconnect(input);
  const next = await expanded.beginAuthorization(input); cb.searchParams.set("state", new URL(next.authorizationUrl).searchParams.get("state")); cb.searchParams.set("scope", "daily");
  state.response = daily;
  await expanded.completeAuthorization({ ...input, callbackUrl: cb.href });
  const before = requests.length;
  await assert.rejects(expanded.invoke({ ...input, operation: "heartRate.list", input: values }), { code: "connector_scope_missing" });
  assert.equal(requests.length, before);
});
