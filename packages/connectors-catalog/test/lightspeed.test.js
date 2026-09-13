import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { lightspeedProvider } from "../src/server/lightspeed.js";

const context = { applicationId: "application-one", subjectId: "user-one" };
const args = { context, integrationId: "retail" };
const scopes = ["products:read", "customers:read", "outlets:read"];
const callback = "https://app.example.test/oauth/lightspeed/callback";
const item = { id: "06bf537b-c783-11e6-f6b9-53a81bd6b215", version: 1690497245, name: null, first_name: null };
const page = { data: [item], version: { min: item.version, max: item.version } };

async function fixture(t, domainPrefix = "fixture-store", selectedScopes = scopes) {
  const directory = await mkdtemp(path.join(tmpdir(), "lightspeed-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const api = `https://${domainPrefix}.retail.lightspeed.app`;
  const state = { time: Date.now(), count: 0, status: 200, value: undefined, tokenStatus: 200, tokenPatch: {}, hang: false };
  const requests = [];
  const configuration = { schemaVersion: 1, registrations: { lightspeed: { source: "own", clientId: "fixture-lightspeed-client", clientSecretRef: "env:LIGHTSPEED_SECRET", callbackUrlRef: "env:LIGHTSPEED_CALLBACK" } },
    integrations: { retail: { provider: "lightspeed", accountMode: "per-user", settings: { domainPrefix }, scopes: selectedScopes, authentication: { method: "oauth2", registrationRef: "lightspeed" } } } };
  const options = {
    configuration, providers: [{ ...lightspeedProvider, requestTimeoutMs: 50 }], authorize: async (owner) => owner,
    now: () => state.time, resolveReference: async (ref) => ({ "env:LIGHTSPEED_SECRET": "fixture-client-secret", "env:LIGHTSPEED_CALLBACK": callback })[ref],
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(5) }, activeKeyId: "current" }) }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)); requests.push({ url, init });
      assert.equal(url.origin, api);
      if (url.pathname === "/api/1.0/token") {
        assert.equal(init.method, "POST");
        assert.match(new Headers(init.headers).get("content-type"), /application\/x-www-form-urlencoded/u);
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), "fixture-lightspeed-client"); assert.equal(body.get("client_secret"), "fixture-client-secret");
        if (body.get("grant_type") === "authorization_code") { assert.equal(body.get("redirect_uri"), callback); assert.equal(body.get("code"), "fixture-code"); }
        else { assert.equal(body.get("grant_type"), "refresh_token"); assert.equal(body.get("refresh_token"), `fixture-refresh-${state.count}`); }
        state.count += 1;
        return Response.json(state.tokenStatus === 200 ? { access_token: `fixture-access-${state.count}`, refresh_token: `fixture-refresh-${state.count}`,
          token_type: "Bearer", expires_in: 60, expires: Math.floor(state.time / 1000) + 60, domain_prefix: domainPrefix, scope: selectedScopes.join(" "), ...state.tokenPatch }
          : { error: "invalid_grant", error_description: "private provider details" }, { status: state.tokenStatus });
      }
      assert.match(url.pathname, /^\/api\/2026-07\/(products|customers|outlets|sales|inventory)$/u);
      assert.equal(init.method, url.pathname.endsWith("/inventory") ? "POST" : "GET"); assert.equal(init.redirect, "error");
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer fixture-access-${state.count}`);
      assert.equal(url.searchParams.has("access_token"), false);
      if (state.hang) return new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Missing abort")), 1000);
        const abort = () => { clearTimeout(timer); reject(init.signal.reason); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
      });
      if (state.status === 204) return new Response(null, { status: 204 });
      if (typeof state.value === "string") return new Response(state.value, { status: state.status });
      return Response.json(state.value === undefined ? page : state.value, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  const start = async () => {
    const { authorizationUrl } = await service.beginAuthorization({ ...args, verificationInput: { page_size: 1 } }); const url = new URL(authorizationUrl);
    const redirect = new URL(callback); redirect.searchParams.set("code", "fixture-code"); redirect.searchParams.set("state", url.searchParams.get("state"));
    redirect.searchParams.set("domain_prefix", domainPrefix); redirect.searchParams.set("scope", selectedScopes.join(" "));
    return { url, callbackUrl: redirect.href };
  };
  const connect = async () => service.completeAuthorization({ ...args, callbackUrl: (await start()).callbackUrl });
  return { directory, service, options, state, requests, start, connect, api };
}

test("Lightspeed uses central code consent, a configured store token endpoint and encrypted restartable files", async (t) => {
  const f = await fixture(t); const started = await f.start();
  assert.equal(started.url.href.split("?")[0], "https://secure.retail.lightspeed.app/connect");
  assert.equal(started.url.searchParams.get("scope"), scopes.join(" "));
  assert.equal(started.url.searchParams.get("redirect_uri"), callback);
  assert.equal(started.url.searchParams.get("code_challenge_method"), "S256"); assert.equal(started.url.searchParams.has("client_secret"), false);
  await f.service.completeAuthorization({ ...args, callbackUrl: started.callbackUrl });
  assert.ok(new URLSearchParams(f.requests[0].init.body).get("code_verifier"));
  assert.equal(f.requests[1].url.search, "?page_size=1&deleted=false");
  for (const file of await readdir(f.directory)) {
    const text = await readFile(path.join(f.directory, file), "utf8");
    for (const secret of ["fixture-code", "fixture-client-secret", "fixture-access-1", "fixture-refresh-1"]) assert.equal(text.includes(secret), false);
  }
  const restarted = createConnectionService(f.options);
  assert.equal((await restarted.status(args)).status, "connected");
  assert.deepEqual(await restarted.invoke({ ...args, operation: "products.list" }), page);
});

test("Lightspeed reads version pages, empty collections and nullable customer fields without traversing automatically", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const operation of ["products.list", "customers.list", "outlets.list"]) {
    const before = f.requests.length;
    assert.deepEqual(await f.service.invoke({ ...args, operation, input: { page_size: 2, after: 100, before: 2000000000, deleted: true } }), page);
    assert.equal(f.requests.length, before + 1); assert.equal(f.requests.at(-1).url.search, "?after=100&before=2000000000&page_size=2&deleted=true");
    f.state.value = { data: [], version: { min: null, max: null } };
    assert.deepEqual(await f.service.invoke({ ...args, operation }), f.state.value);
    f.state.value = undefined;
  }
  f.state.value = { data: [{ ...item, first_name: null, last_name: null }] };
  assert.deepEqual(await f.service.invoke({ ...args, operation: "customers.list" }), f.state.value);
  f.state.value = { data: [] }; assert.deepEqual(await f.service.invoke({ ...args, operation: "customers.list" }), { data: [] });
});

test("Lightspeed rejects invalid version bounds, unsupported searches, arbitrary URLs and writes before transport", async (t) => {
  const f = await fixture(t); await f.connect(); const before = f.requests.length;
  for (const input of [{ after: -1 }, { after: 1.5 }, { after: Number.MAX_SAFE_INTEGER + 1 }, { before: -1 }, { before: 2.5 },
    { after: 10, before: 10 }, { after: 11, before: 10 }, { page_size: 101 }, { page_size: 0 }, { page_size: 1.5 }, { deleted: "wrong" },
    { url: "https://other.test" }, { domain_prefix: "other-store" }, { sku: "fixture" }, { name: "fixture" }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "products.list", input }), { code: "connector_input_invalid" });
  }
  await assert.rejects(f.service.invoke({ ...args, operation: "products.create" }), { code: "connector_operation_unknown" });
  assert.equal(f.requests.length, before);
});

test("Lightspeed uses actual granted scopes and host ownership before any store read", async (t) => {
  const f = await fixture(t); f.state.tokenPatch.scope = "products:read"; await f.connect();
  assert.deepEqual((await f.service.status(args)).grantedScopes, ["products:read"]);
  await assert.rejects(f.service.invoke({ ...args, operation: "customers.list" }), { code: "connector_scope_missing" });
  for (const owner of [{ ...context, applicationId: "other" }, { ...context, subjectId: "other" }]) {
    await assert.rejects(f.service.invoke({ ...args, context: owner, operation: "products.list" }), { code: "connector_reconnect_required" });
  }
  const denied = createConnectionService({ ...f.options, authorize: async () => null });
  await assert.rejects(denied.invoke({ ...args, operation: "products.list" }), { code: "connector_access_denied" });
  assert.equal(f.requests.length, 2);
  const reduced = await fixture(t); reduced.state.tokenPatch.scope = "customers:read";
  await assert.rejects(reduced.connect(), { code: "connector_scope_missing" });
  assert.equal((await reduced.service.status(args)).status, "disconnected"); assert.equal(reduced.requests.length, 1);
});

test("Lightspeed persists every rotated refresh token even if the subsequent API read fails", async (t) => {
  const f = await fixture(t); await f.connect(); f.state.time += 40_000;
  await Promise.all([f.service.invoke({ ...args, operation: "products.list" }), f.service.invoke({ ...args, operation: "products.list" })]);
  assert.equal(f.state.count, 2);
  f.state.time += 40_000; f.state.status = 429;
  await assert.rejects(f.service.invoke({ ...args, operation: "products.list" }), { code: "connector_rate_limited" });
  f.state.status = 200;
  const restarted = createConnectionService(f.options); await restarted.invoke({ ...args, operation: "products.list" });
  assert.equal(f.state.count, 3); assert.deepEqual((await restarted.status(args)).grantedScopes, scopes);
  f.state.time += 40_000; await restarted.invoke({ ...args, operation: "customers.list" }); assert.equal(f.state.count, 4);
});

test("Lightspeed rejects mismatched store grants and never follows callback-supplied destinations", async (t) => {
  for (const prefix of [undefined, "other-store", "fixture-store.attacker.test", "https://fixture-store.retail.lightspeed.app"]) {
    const f = await fixture(t); f.state.tokenPatch.domain_prefix = prefix;
    const start = await f.start(); const redirect = new URL(start.callbackUrl); redirect.searchParams.set("domain_prefix", "attacker.test");
    await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: redirect.href }), { code: "connector_response_invalid" });
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url.origin, f.api);
  }
});

test("Lightspeed requires scopes, expiry and replacement refresh tokens from successful token responses", async (t) => {
  for (const patch of [{ scope: undefined }, { scope: "" }, { scope: "products:read\ncustomers:read" }, { expires_in: undefined },
    { expires_in: 0 }, { expires_in: 1.5 }, { refresh_token: undefined }, { refresh_token: "" }]) {
    const f = await fixture(t); f.state.tokenPatch = patch;
    await assert.rejects(f.connect(), { code: "connector_response_invalid" }); assert.equal(f.requests.length, 1);
  }
  const f = await fixture(t); await f.connect(); f.state.time += 40_000; f.state.tokenPatch.refresh_token = undefined;
  await assert.rejects(f.service.invoke({ ...args, operation: "products.list" }), { code: "connector_response_invalid" });
  assert.equal(f.requests.length, 3);
});

test("Lightspeed configuration changes invalidate grants and denied, cancelled or replayed consent preserves saved access", async (t) => {
  const f = await fixture(t); await f.connect();
  const configuration = structuredClone(f.options.configuration); configuration.integrations.retail.settings.domainPrefix = "other-store";
  await assert.rejects(createConnectionService({ ...f.options, configuration }).invoke({ ...args, operation: "products.list" }), { code: "connector_reconnect_required" });
  const start = await f.start(); const denied = new URL(start.callbackUrl); denied.searchParams.delete("code"); denied.searchParams.set("error", "access_denied");
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: denied.href }), { code: "connector_consent_denied" });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: start.callbackUrl }), { code: "connector_attempt_invalid" });
  const pending = await f.start(); await f.service.cancelAuthorization({ ...args, state: pending.url.searchParams.get("state") });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: pending.callbackUrl }), { code: "connector_attempt_invalid" });
  assert.equal((await f.service.status(args)).status, "connected");
  await f.service.disconnect(args); assert.equal((await f.service.status(args)).status, "disconnected");
  assert.equal(f.requests.length, 2);
});

test("Lightspeed rejects malformed successes and oversized pages and redacts provider failures", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const [status, code] of [[403, "connector_permission_denied"], [500, "connector_provider_failed"], [429, "connector_rate_limited"]]) {
    f.state.status = status; f.state.value = { message: "private provider details" };
    await assert.rejects(f.service.invoke({ ...args, operation: "products.list" }), (error) => error.code === code && !error.message.includes("private"));
  }
  f.state.status = 200;
  for (const value of [null, "invalid json", {}, { data: [] }, { data: [{ ...item, version: Number.MAX_SAFE_INTEGER + 1 }], version: page.version },
    { data: [{ ...item, id: null }], version: page.version }, { data: [], version: { min: 0, max: null } },
    { data: [item], version: { min: item.version + 1, max: item.version } }, { data: [item, item], version: page.version }]) {
    f.state.value = value;
    await assert.rejects(f.service.invoke({ ...args, operation: "products.list", input: { page_size: 1 } }), (error) => ["connector_response_invalid", "connector_provider_failed"].includes(error.code));
  }
  f.state.value = undefined; f.state.status = 204;
  await assert.rejects(f.service.invoke({ ...args, operation: "products.list" }), { code: "connector_response_invalid" });
  f.state.status = 401;
  await assert.rejects(f.service.invoke({ ...args, operation: "products.list" }), { code: "connector_reconnect_required" });
});

test("Lightspeed invalid refresh tokens require reconnect without returning provider text", async (t) => {
  const f = await fixture(t); await f.connect(); f.state.time += 40_000; f.state.tokenStatus = 400;
  await assert.rejects(f.service.invoke({ ...args, operation: "products.list" }), (error) => error.code === "connector_reconnect_required" && !error.message.includes("private"));
  assert.equal((await f.service.status(args)).status, "reconnect-required"); assert.equal(f.requests.length, 3);
});

test("Lightspeed delivers cancellation and timeout without retry", async (t) => {
  const f = await fixture(t); await f.connect(); f.state.hang = true;
  const abort = new AbortController(); const result = f.service.invoke({ ...args, operation: "customers.list", signal: abort.signal });
  setTimeout(() => abort.abort(), 10); await assert.rejects(result, { code: "connector_cancelled" });
  await assert.rejects(f.service.invoke({ ...args, operation: "customers.list" }), { code: "connector_provider_timeout" });
  assert.equal(f.requests.length, 4);
});

test("Lightspeed guide and form share strict store/reference validation and all 49 permissions", async () => {
  const guide = await readFile(new URL("../docs/lightspeed.md", import.meta.url), "utf8");
  const json = guide.match(/```json\n([\s\S]*?)\n```/u)[1];
  const configuration = parseIntegrationConfiguration(json, { providers: [lightspeedProvider] });
  assert.equal(configuration.integrations.retail.settings.domainPrefix, "your-store");
  assert.equal(lightspeedProvider.scopes.length, 49); assert.equal(lightspeedProvider.scopes.filter((scope) => scope.recommended).length, 16);
  for (const value of ["", "https://your-store.retail.lightspeed.app", "a.b", "a b", "a/b", "a@b", "a?b", "-a", "a-", "STORE", "a".repeat(64)]) {
    const invalid = JSON.parse(json); invalid.integrations.retail.settings.domainPrefix = value;
    assert.throws(() => parseIntegrationConfiguration(JSON.stringify(invalid), { providers: [lightspeedProvider] }));
  }
  for (const [field, value] of [["clientSecretRef", "raw-secret"], ["callbackUrlRef", callback]]) {
    const invalid = JSON.parse(json); invalid.registrations.lightspeed[field] = value;
    assert.throws(() => parseIntegrationConfiguration(JSON.stringify(invalid), { providers: [lightspeedProvider] }));
  }
});


test("Lightspeed inventory and sales preserve quantities, paging and permission boundaries", async t => {
  const f = await fixture(t, "fixture-store", [...scopes, "inventory:read", "sales:read"]); await f.connect();
  f.state.value = [{ product_id: item.id, outlet_id: "outlet-1", version: 100, current_inventory_level: "4.000", quantity_to_procure: "2.000" }];
  assert.deepEqual(await f.service.invoke({ ...args, operation: "inventory.list", input: { size: 2, product_id: item.id, variants: true } }), f.state.value);
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { size: 2, include_deleted: false, sort_direction: "asc", product_id: item.id, variants: true });
  await f.service.invoke({ ...args, operation: "inventory.list", input: { after: 100, size: 2 } });
  assert.equal(JSON.parse(f.requests.at(-1).init.body).after, 100);
  f.state.value = [];
  assert.deepEqual(await f.service.invoke({ ...args, operation: "inventory.list" }), []);
  f.state.value = { data: [{ ...item, customer_id: "customer-1", total_price: "42.50" }], version: page.version };
  assert.deepEqual(await f.service.invoke({ ...args, operation: "sales.list", input: { page_size: 2 } }), f.state.value);
  assert.equal(f.requests.at(-1).url.search, "?page_size=2");
  const before = f.requests.length;
  for (const invalid of [{ variants: true }, { after: 2, before: 1 }, { size: 1001 }, { product_id: "../other" }])
    await assert.rejects(f.service.invoke({ ...args, operation: "inventory.list", input: invalid }), { code: "connector_input_invalid" });
  const denied = createConnectionService({ ...f.options, authorize: async (owner, request) => request.operation === "sales.list" ? null : owner });
  await assert.rejects(denied.invoke({ ...args, operation: "sales.list" }), { code: "connector_access_denied" });
  assert.equal(f.requests.length, before);
  for (const malformed of [{ data: [] }, [{ version: "unknown" }], [{ version: 1 }, { version: 2 }]]) {
    f.state.value = malformed;
    await assert.rejects(f.service.invoke({ ...args, operation: "inventory.list", input: { size: 1 } }), { code: "connector_response_invalid" });
  }
  const limited = await fixture(t); await limited.connect(); const count = limited.requests.length;
  await assert.rejects(limited.service.invoke({ ...args, operation: "inventory.list" }), { code: "connector_scope_missing" });
  assert.equal(limited.requests.length, count);
});
