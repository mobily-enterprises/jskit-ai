import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { validateIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { salesforceProvider as provider } from "../src/server/salesforce.js";

const context = { applicationId: "crm-app", subjectId: "user-one" };
const input = { context, integrationId: "crm" };
const accountUrl = "https://fixture.my.salesforce.com";
const callback = "https://app.example.test/connections/salesforce/callback";
const limits = { DailyApiRequests: { Max: 100000, Remaining: 75000 }, DailyBulkApiRequests: { Max: 15000, Remaining: 15000 } };
const cursor = "/services/data/v66.0/query/0r82211CelDTLqEAEX-2000";
const page = { totalSize: 1, done: true, records: [{ attributes: { type: "Account", url: "/services/data/v66.0/sobjects/Account/001000000000001AAA" }, Id: "001000000000001AAA", Name: "Fixture" }] };

async function fixture(t, settings = { environment: "production", accountUrl }) {
  const directory = await mkdtemp(path.join(tmpdir(), "salesforce-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const origin = new URL(settings.accountUrl).origin;
  const state = { time: Date.now(), grants: 0, requests: [], tokenStatus: 200, status: 200, scope: "api refresh_token", refresh: true,
    tokenOrigin: origin, response: page, secret: "fixture-secret", deny: false, stall: false };
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" });
  const configuration = { schemaVersion: 1, integrations: { crm: { provider: "salesforce", accountMode: "per-user", settings,
    scopes: ["api", "refresh_token"], authentication: { method: "oauth2", registrationRef: "sf" } } },
  registrations: { sf: { source: "own", clientId: "fixture-client", clientSecretRef: "env:SF_SECRET", callbackUrlRef: "env:SF_CALLBACK" } } };
  const options = { configuration, providers: [provider], store: createFileConnectionStore({ directory, protection }), now: () => state.time,
    authorize: async (owner) => { if (state.deny) throw new Error("Host denied"); return owner; },
    resolveReference: async (ref) => { if (ref === "env:SF_CALLBACK") return callback; if (ref === "env:SF_SECRET") return state.secret; throw new Error("Unknown reference"); },
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)); const headers = new Headers(init.headers);
      state.requests.push({ url, init, headers });
      assert.equal(url.origin, origin);
      const token = url.pathname === "/services/oauth2/token";
      if (state.stall === true || state.stall === (token ? "token" : "api")) return new Promise((resolve, reject) => {
        init.signal.throwIfAborted(); init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
      if (token) {
        assert.equal(init.redirect, "manual"); assert.equal(headers.has("authorization"), false);
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), "fixture-client"); assert.equal(body.get("client_secret"), state.secret);
        if (body.get("grant_type") === "refresh_token") assert.equal(body.get("refresh_token"), state.lastRefresh);
        if (state.tokenStatus !== 200) return Response.json({ error: "invalid_grant", error_description: "fixture-secret" }, { status: state.tokenStatus });
        state.grants += 1;
        if (state.badToken) return Response.json(state.badToken);
        if (state.refresh) state.lastRefresh = `refresh-${state.grants}`;
        return Response.json({ access_token: `access-${state.grants}`, token_type: "Bearer", instance_url: state.tokenOrigin,
          scope: state.scope, ...(state.refresh ? { refresh_token: state.lastRefresh } : {}), ...(state.expiry === undefined ? {} : { expires_in: state.expiry }) });
      }
      assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
      assert.equal(headers.get("authorization"), `Bearer access-${state.grants}`); assert.equal(init.body, undefined);
      if (state.status !== 200) return new Response(state.raw || JSON.stringify([{ errorCode: state.errorCode || "FIXTURE_ERROR", message: "fixture-secret" }]), { status: state.status });
      if (state.raw) return new Response(state.raw, { headers: { "Content-Type": "application/json" } });
      return Response.json(url.pathname.endsWith("/limits") ? (state.limits || limits) : state.response);
    }
  };
  const service = createConnectionService(options);
  const start = async (target = service) => {
    const result = await target.beginAuthorization(input); const url = new URL(result.authorizationUrl);
    const returned = new URL(callback); returned.searchParams.set("code", "fixture-code"); returned.searchParams.set("state", url.searchParams.get("state"));
    return { url, callbackUrl: returned.href };
  };
  const connect = async (target = service) => target.completeAuthorization({ ...input, callbackUrl: (await start(target)).callbackUrl });
  return { options, service, state, directory, protection, configuration, start, connect };
}

test("Salesforce shares production/developer/sandbox configuration validation with CLI and rejects credentials as references", async (t) => {
  const f = await fixture(t);
  for (const [environment, url] of [["production", accountUrl], ["production", "https://fixture.develop.my.salesforce.com/"], ["sandbox", "https://fixture--uat.sandbox.my.salesforce.com"]]) {
    for (const accountMode of provider.accountModes) {
      const config = structuredClone(f.configuration); config.integrations.crm.settings = { environment, accountUrl: url }; config.integrations.crm.accountMode = accountMode;
      assert.deepEqual(validateIntegrationConfiguration(config, { providers: [provider] }), config);
    }
  }
  for (const url of ["https://login.salesforce.com", "https://test.salesforce.com", "http://fixture.my.salesforce.com", "https://fixture.my.salesforce.com.evil.test", "https://fixture.my.salesforce.com:443",
    "https://fixture.my.salesforce.com/path", "https://fixture.my.salesforce.com?x=1", "https://user@fixture.my.salesforce.com", "https://FIXTURE.my.salesforce.com", " https://fixture.my.salesforce.com", "https://fixture.sandbox.my.salesforce.com"]) {
    const config = structuredClone(f.configuration); config.integrations.crm.settings.accountUrl = url;
    assert.throws(() => validateIntegrationConfiguration(config, { providers: [provider] }), undefined, url);
  }
  const sandbox = structuredClone(f.configuration); sandbox.integrations.crm.settings.environment = "sandbox";
  assert.throws(() => validateIntegrationConfiguration(sandbox, { providers: [provider] }));
  for (const field of ["clientSecretRef", "callbackUrlRef"]) for (const value of ["literal-secret", "https://paste.invalid", ""]) {
    const config = structuredClone(f.configuration); config.registrations.sf[field] = value;
    assert.throws(() => validateIntegrationConfiguration(config, { providers: [provider] }));
  }
});

test("Salesforce pins My Domain for PKCE consent, secret-post exchange and API verification in both environments", async (t) => {
  for (const settings of [{ environment: "production", accountUrl }, { environment: "sandbox", accountUrl: "https://fixture--uat.sandbox.my.salesforce.com/" }]) {
    const f = await fixture(t, settings); const { url, callbackUrl } = await f.start();
    const origin = new URL(settings.accountUrl).origin;
    assert.equal(url.origin + url.pathname, origin + "/services/oauth2/authorize");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256"); assert.equal(url.searchParams.get("redirect_uri"), callback);
    assert.equal(url.searchParams.get("scope"), "api refresh_token"); assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.has("client_secret"), false); assert.equal(url.searchParams.has("openid"), false);
    f.state.tokenOrigin += "/";
    const connection = await f.service.completeAuthorization({ ...input, callbackUrl });
    assert.equal(connection.status, "connected");
    const body = new URLSearchParams(f.state.requests[0].init.body);
    assert.equal(body.get("code"), "fixture-code"); assert.ok(body.get("code_verifier")); assert.equal(body.get("redirect_uri"), callback);
    assert.equal(f.state.requests[1].url.href, origin + "/services/data/v66.0/limits");
    await assert.rejects(f.service.completeAuthorization({ ...input, callbackUrl }), { code: "connector_attempt_invalid" });
    assert.equal(f.state.requests.length, 2);
  }
});

test("Salesforce exposes bounded SOQL reads, strict next-page destinations and object discovery", async (t) => {
  const f = await fixture(t); await f.connect();
  const q = "SELECT Id, Name FROM Account WHERE Name = 'ACME & Sons + 😀' ORDER BY Id LIMIT 10";
  assert.deepEqual(await f.service.invoke({ ...input, operation: "query.read", input: { q } }), page);
  assert.equal(f.state.requests.at(-1).url.searchParams.get("q"), q);
  f.state.response = { ...page, totalSize: 2001, done: false, nextRecordsUrl: cursor };
  assert.equal((await f.service.invoke({ ...input, operation: "query.read", input: { q } })).nextRecordsUrl, cursor);
  f.state.response = { totalSize: 2001, done: true, records: [{ expr0: 3 }] };
  await f.service.invoke({ ...input, operation: "query.next", input: { nextRecordsUrl: cursor } });
  assert.equal(f.state.requests.at(-1).url.href, accountUrl + cursor);
  f.state.response = { sobjects: [{ name: "ns__Widget__c", label: "Widgets", queryable: true }] };
  await f.service.invoke({ ...input, operation: "objects.list" });
  f.state.response = { name: "ns__Widget__c", fields: [{ name: "Name", type: "string" }] };
  await f.service.invoke({ ...input, operation: "objects.describe", input: { object: "ns__Widget__c" } });
  assert.equal(f.state.requests.at(-1).url.pathname, "/services/data/v66.0/sobjects/ns__Widget__c/describe");
  f.state.response = { totalSize: 0, done: true, records: [] };
  assert.deepEqual(await f.service.invoke({ ...input, operation: "query.read", input: { q: "SELECT Id FROM Account LIMIT 1" } }), f.state.response);
});

test("Salesforce rejects unsupported query effects, Unicode size, cursors and arbitrary transport inputs before requests", async (t) => {
  const f = await fixture(t); await f.connect(); const count = f.state.requests.length;
  for (const q of ["", "DELETE FROM Account", "SELECT Id FROM Account FOR UPDATE", "SELECT Id FROM Account FOR VIEW", "SELECT Id FROM Account FOR REFERENCE", "SELECT\nId FROM Account", "SELECT " + "x".repeat(2000), "SELECT '" + "界".repeat(1100) + "' FROM Account"]) {
    await assert.rejects(f.service.invoke({ ...input, operation: "query.read", input: { q } }), { code: "connector_input_invalid" });
  }
  for (const nextRecordsUrl of ["https://evil.invalid" + cursor, "//evil.invalid" + cursor, cursor + "?x=1", cursor.replace("v66.0", "v65.0"), cursor.replace("/query/", "/queryAll/"), cursor + "/../limits", "%2fservices/data", ""]) {
    await assert.rejects(f.service.invoke({ ...input, operation: "query.next", input: { nextRecordsUrl } }), { code: "connector_input_invalid" });
  }
  for (const object of ["Account/../../limits", "Name,Id", "", "_bad"]) await assert.rejects(f.service.invoke({ ...input, operation: "objects.describe", input: { object } }), { code: "connector_input_invalid" });
  await assert.rejects(f.service.invoke({ ...input, operation: "query.read", input: { q: "SELECT Id FROM Account", headers: { Authorization: "x" } } }), { code: "connector_input_invalid" });
  await assert.rejects(f.service.invoke({ ...input, operation: "limits.read", input: { url: "https://evil.invalid" } }), { code: "connector_input_invalid" });
  assert.equal(f.state.requests.length, count);
});

test("Salesforce encrypted file restart preserves ownership and renews an undated grant under one lock", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const name of await readdir(f.directory)) {
    const value = await readFile(path.join(f.directory, name), "utf8");
    for (const secret of ["fixture-secret", "access-1", "refresh-1"]) assert.equal(value.includes(secret), false);
  }
  const restarted = createConnectionService({ ...f.options, store: createFileConnectionStore({ directory: f.directory, protection: f.protection }) });
  await restarted.invoke({ ...input, operation: "limits.read" }); assert.equal(f.state.grants, 1);
  for (const owner of [{ ...context, subjectId: "user-two" }, { ...context, applicationId: "other-app" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "limits.read" }), { code: "connector_reconnect_required" });
  }
  f.state.time += 300000; f.state.secret = "rotated-secret";
  await Promise.all([restarted.invoke({ ...input, operation: "limits.read" }), f.service.invoke({ ...input, operation: "limits.read" })]);
  assert.equal(f.state.grants, 2);
  const count = f.state.requests.length; await restarted.disconnect(input);
  assert.equal(f.state.requests.length, count); assert.equal((await f.service.status(input)).status, "disconnected");
});

test("Salesforce persists rotation before later failures and retains a previous refresh token when none is returned", async (t) => {
  const f = await fixture(t); f.state.expiry = 60; await f.connect(); f.state.time += 60000;
  f.state.refresh = false; f.state.status = 403; f.state.errorCode = "REQUEST_LIMIT_EXCEEDED";
  await assert.rejects(f.service.invoke({ ...input, operation: "limits.read" }), { code: "connector_rate_limited" });
  assert.equal(f.state.grants, 2); f.state.status = 200; f.state.time += 60000; f.state.refresh = true;
  await createConnectionService(f.options).invoke({ ...input, operation: "limits.read" }); assert.equal(f.state.grants, 3);
  f.state.time += 60000; f.state.scope = "refresh_token";
  await assert.rejects(f.service.invoke({ ...input, operation: "limits.read" }), { code: "connector_scope_missing" });
  assert.deepEqual((await f.service.status(input)).grantedScopes, ["refresh_token"]);
});

test("Salesforce rejects foreign and malformed grants, missing API consent and changed org/client configuration", async (t) => {
  const f = await fixture(t);
  for (const tokenOrigin of ["https://other.my.salesforce.com", accountUrl + "/path", "https://evil.invalid", "https://login.salesforce.com"]) {
    f.state.tokenOrigin = tokenOrigin; await assert.rejects(f.connect(), { code: "connector_response_invalid" });
    assert.equal((await f.service.status(input)).status, "disconnected");
  }
  f.state.tokenOrigin = accountUrl; f.state.badToken = { instance_url: accountUrl, access_token: "bad", token_type: "Bearer" };
  await assert.rejects(f.connect(), { code: "connector_response_invalid" }); delete f.state.badToken;
  f.state.scope = "refresh_token"; await assert.rejects(f.connect(), { code: "connector_scope_missing" });
  f.state.scope = "api refresh_token"; await f.connect(); const pending = await f.start(); const count = f.state.requests.length;
  for (const field of ["domain", "environment", "client"]) {
    const config = structuredClone(f.configuration);
    if (field === "client") config.registrations.sf.clientId = "different-client";
    else config.integrations.crm.settings = field === "domain" ? { environment: "production", accountUrl: "https://other.my.salesforce.com" }
      : { environment: "sandbox", accountUrl: "https://fixture--uat.sandbox.my.salesforce.com" };
    const changed = createConnectionService({ ...f.options, configuration: config });
    assert.equal((await changed.status(input)).status, "reconnect-required");
    await assert.rejects(changed.completeAuthorization({ ...input, callbackUrl: pending.callbackUrl }), { code: "connector_attempt_invalid" });
    await assert.rejects(changed.invoke({ ...input, operation: "limits.read" }), { code: "connector_reconnect_required" });
  }
  assert.equal(f.state.requests.length, count);
});

test("Salesforce malformed pages, cursors, object names and limits cannot become successful responses", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const response of [{}, { ...page, totalSize: -1 }, { ...page, totalSize: 0 }, { ...page, done: false }, { ...page, records: [null] },
    { ...page, totalSize: 3000, records: Array(2001).fill({}) }, { ...page, done: false, nextRecordsUrl: "https://evil.invalid" + cursor }, { ...page, nextRecordsUrl: cursor }]) {
    f.state.response = response;
    await assert.rejects(f.service.invoke({ ...input, operation: "query.read", input: { q: "SELECT Id FROM Account" } }), { code: "connector_response_invalid" });
  }
  f.state.response = { name: "Other", fields: [] };
  await assert.rejects(f.service.invoke({ ...input, operation: "objects.describe", input: { object: "Account" } }), { code: "connector_response_invalid" });
  f.state.limits = { DailyApiRequests: { Max: 100, Remaining: -1 } };
  await assert.rejects(f.service.invoke({ ...input, operation: "limits.read" }), { code: "connector_response_invalid" });
  f.state.raw = "not-json";
  await assert.rejects(f.service.invoke({ ...input, operation: "objects.list" }), { code: "connector_response_invalid" });
});

test("Salesforce maps org limits, expired cursors and provider failures without exposing responses or retrying", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const [status, errorCode, code] of [[403, "REQUEST_LIMIT_EXCEEDED", "connector_rate_limited"], [400, "INVALID_QUERY_LOCATOR", "connector_cursor_expired"],
    [400, "MALFORMED_QUERY", "connector_query_invalid"], [404, "NOT_FOUND", "connector_resource_not_found"], [403, "API_DISABLED_FOR_ORG", "connector_permission_denied"],
    [429, "OTHER", "connector_rate_limited"], [500, "OTHER", "connector_provider_failed"], [302, "OTHER", "connector_provider_failed"], [401, "INVALID_SESSION_ID", "connector_reconnect_required"]]) {
    Object.assign(f.state, { status, errorCode }); const count = f.state.requests.length;
    await assert.rejects(f.service.invoke({ ...input, operation: "query.read", input: { q: "SELECT Id FROM Account" } }), (error) => {
      assert.equal(error.code, code); assert.equal(JSON.stringify(error).includes("fixture-secret"), false); return true;
    });
    assert.equal(f.state.requests.length, count + 1);
  }
  assert.equal((await f.service.status(input)).status, "reconnect-required");
});

test("Salesforce host policy, cancelled/denied consent and managed references cannot silently connect", async (t) => {
  const f = await fixture(t); let pending = await f.start();
  await f.service.cancelAuthorization({ ...input, state: pending.url.searchParams.get("state") });
  await assert.rejects(f.service.completeAuthorization({ ...input, callbackUrl: pending.callbackUrl }), { code: "connector_attempt_invalid" });
  pending = await f.start(); const denied = new URL(pending.callbackUrl); denied.searchParams.delete("code"); denied.searchParams.set("error", "access_denied");
  await assert.rejects(f.service.completeAuthorization({ ...input, callbackUrl: denied.href }), { code: "connector_consent_denied" });
  f.state.deny = true; await assert.rejects(f.service.beginAuthorization(input), /Host denied/);
  assert.equal(f.state.requests.length, 0);
  f.state.deny = false;
  const config = structuredClone(f.configuration); config.registrations.sf = { source: "managed", serviceUrlRef: "env:GATEWAY", serviceCredentialRef: "env:APP", assignmentRef: "online" };
  assert.throws(() => createConnectionService({ ...f.options, configuration: config }), { code: "integration_configuration_invalid" });
  assert.equal(f.state.requests.length, 0);
});

test("Salesforce cancellation and timeout interrupt requests and a revoked refresh becomes reconnect-required", async (t) => {
  // The fake transport has no socket to keep Node 22 alive for an unrefed timeout.
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keepAlive));
  const f = await fixture(t); await f.connect(); f.state.stall = "api";
  const timed = createConnectionService({ ...f.options, providers: [{ ...provider, requestTimeoutMs: 30 }] });
  await assert.rejects(timed.invoke({ ...input, operation: "limits.read" }), { code: "connector_provider_timeout" });
  const controller = new AbortController(); const pending = f.service.invoke({ ...input, operation: "limits.read", signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending, { code: "connector_cancelled" }); clearTimeout(timer);
  assert.equal((await f.service.status(input)).status, "connected");
  f.state.stall = false; f.state.time += 300000; f.state.tokenStatus = 400;
  await assert.rejects(f.service.invoke({ ...input, operation: "limits.read" }), { code: "connector_reconnect_required" });
  assert.equal((await f.service.status(input)).status, "reconnect-required");
});

test("Salesforce query policy authorizes an immutable request and denies data access before HTTP", async (t) => {
  const f = await fixture(t); await f.connect();
  const allowed = "SELECT Id FROM Account LIMIT 1";
  const caller = { q: allowed };
  const service = createConnectionService({ ...f.options, authorize: async (owner, request) => {
    if (request.operation === "query.read") {
      assert.equal(request.input.q, allowed);
      caller.q = "SELECT Id FROM Contact";
      request.input.q = "SELECT Id FROM Lead";
    }
    return owner;
  } });
  await service.invoke({ ...input, operation: "query.read", input: caller });
  assert.equal(f.state.requests.at(-1).url.searchParams.get("q"), allowed);
  const count = f.state.requests.length;
  const denied = createConnectionService({ ...f.options, authorize: async () => { throw new Error("Query not allowed"); },
    resolveReference: async () => { assert.fail("No credentials should be resolved before authorization"); } });
  await assert.rejects(denied.invoke({ ...input, operation: "query.read", input: { q: allowed } }), /Query not allowed/);
  assert.equal(f.state.requests.length, count);
});

test("Salesforce packaged configuration example validates with the same CLI schema", async () => {
  const guide = await readFile(new URL("../docs/salesforce.md", import.meta.url), "utf8");
  const json = /```json\n([\s\S]*?)\n```/u.exec(guide)?.[1]; assert.ok(json);
  const configuration = JSON.parse(json);
  assert.deepEqual(validateIntegrationConfiguration(configuration, { providers: [provider] }), configuration);
});
