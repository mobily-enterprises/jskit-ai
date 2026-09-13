import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { zohoCrmProvider } from "../src/server/zoho-crm.js";

const context = { applicationId: "application-one", subjectId: "user-one" };
const args = { context, integrationId: "crm" };
const scopes = ["ZohoCRM.users.READ", "ZohoCRM.modules.leads.READ", "ZohoCRM.modules.contacts.READ", "ZohoCRM.modules.accounts.READ", "ZohoCRM.modules.deals.READ"];
const callback = "https://app.example.test/oauth/zoho-crm/callback";
const profile = { users: [{ id: "5725767000000411001", full_name: "Fixture User" }] };
const regions = {
  us: ["https://accounts.zoho.com", "com"], eu: ["https://accounts.zoho.eu", "eu"],
  in: ["https://accounts.zoho.in", "in"], au: ["https://accounts.zoho.com.au", "com.au"],
  jp: ["https://accounts.zoho.jp", "jp"], ca: ["https://accounts.zohocloud.ca", "ca"], cn: ["https://accounts.zoho.com.cn", "com.cn"]
};

async function fixture(t, settings = { region: "us", environment: "production" }, selectedScopes = scopes) {
  const directory = await mkdtemp(path.join(tmpdir(), "zoho-crm-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const [accounts, suffix] = regions[settings.region];
  const api = `https://${settings.environment === "production" ? "www" : settings.environment}.zohoapis.${suffix}`;
  const state = { time: Date.now(), count: 0, status: 200, value: undefined, tokenStatus: 200, tokenValue: undefined, hang: false };
  const requests = [];
  const configuration = { schemaVersion: 1, registrations: { zoho: { source: "own", clientId: "fixture-zoho-client", clientSecretRef: "env:ZOHO_SECRET", callbackUrlRef: "env:ZOHO_CALLBACK" } },
    integrations: { crm: { provider: "zoho-crm", accountMode: "per-user", settings, scopes: selectedScopes, authentication: { method: "oauth2", registrationRef: "zoho" } } } };
  const options = {
    configuration, providers: [{ ...zohoCrmProvider, requestTimeoutMs: 50 }], authorize: async (owner) => owner,
    now: () => state.time, resolveReference: async (ref) => ({ "env:ZOHO_SECRET": "fixture-client-secret", "env:ZOHO_CALLBACK": callback })[ref],
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(5) }, activeKeyId: "current" }) }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address));
      requests.push({ url, init });
      if (url.origin === accounts) {
        assert.equal(url.pathname, "/oauth/v2/token"); assert.equal(init.method, "POST");
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), "fixture-zoho-client"); assert.equal(body.get("client_secret"), "fixture-client-secret");
        if (body.get("grant_type") === "authorization_code") assert.equal(body.get("redirect_uri"), callback);
        else { assert.equal(body.get("grant_type"), "refresh_token"); assert.equal(body.get("refresh_token"), "fixture-refresh-token"); }
        state.count += 1;
        return Response.json(state.tokenValue ?? { access_token: `fixture-access-${state.count}`, ...(state.count === 1 ? { refresh_token: "fixture-refresh-token" } : {}),
          token_type: "Bearer", api_domain: api, expires_in: 60 }, { status: state.tokenStatus });
      }
      assert.equal(url.origin, api); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
      assert.equal(new Headers(init.headers).get("authorization"), `Zoho-oauthtoken fixture-access-${state.count}`);
      assert.equal(url.searchParams.has("access_token"), false);
      if (state.hang) return new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Missing abort")), 1000);
        const abort = () => { clearTimeout(timer); reject(init.signal.reason); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
      });
      if (state.status === 204) return new Response(null, { status: 204 });
      if (typeof state.value === "string") return new Response(state.value, { status: state.status });
      const value = url.pathname.endsWith("/users") ? profile : { data: [{ id: "5725767000000411002", Last_Name: "Fixture", Email: null }],
        info: { count: 1, per_page: Number(url.searchParams.get("per_page")), ...(url.searchParams.has("page") ? { page: Number(url.searchParams.get("page")) } : {}), more_records: true, next_page_token: "fixture-next", previous_page_token: null } };
      return Response.json(state.value === undefined ? value : state.value, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  const start = async () => {
    const { authorizationUrl } = await service.beginAuthorization(args); const url = new URL(authorizationUrl);
    const redirect = new URL(callback); redirect.searchParams.set("code", "fixture-code"); redirect.searchParams.set("state", url.searchParams.get("state"));
    redirect.searchParams.set("location", settings.region); redirect.searchParams.set("accounts-server", accounts);
    return { url, callbackUrl: redirect.href };
  };
  const connect = async () => service.completeAuthorization({ ...args, callbackUrl: (await start()).callbackUrl });
  return { directory, service, options, state, requests, start, connect, api, accounts };
}

test("Zoho CRM uses regional code consent, PKCE, offline access and encrypted restartable file storage", async (t) => {
  const f = await fixture(t); const started = await f.start();
  assert.equal(started.url.href.split("?")[0], "https://accounts.zoho.com/oauth/v2/auth");
  assert.equal(started.url.searchParams.get("scope"), scopes.join(","));
  assert.equal(started.url.searchParams.get("access_type"), "offline"); assert.equal(started.url.searchParams.get("prompt"), "consent");
  assert.equal(started.url.searchParams.get("code_challenge_method"), "S256"); assert.equal(started.url.searchParams.has("client_secret"), false);
  await f.service.completeAuthorization({ ...args, callbackUrl: started.callbackUrl });
  assert.ok(new URLSearchParams(f.requests[0].init.body).get("code_verifier"));
  assert.equal(f.requests[1].url.search, "?type=CurrentUser");
  for (const file of await readdir(f.directory)) {
    const text = await readFile(path.join(f.directory, file), "utf8");
    for (const secret of ["fixture-code", "fixture-client-secret", "fixture-access-1", "fixture-refresh-token"]) assert.equal(text.includes(secret), false);
  }
  const restarted = createConnectionService(f.options);
  assert.equal((await restarted.status(args)).status, "connected");
  assert.deepEqual(await restarted.invoke({ ...args, operation: "users.current" }), profile);
});

test("Zoho CRM routes all seven data centers and three environments to fixed selected hosts", async (t) => {
  for (const region of Object.keys(regions)) for (const environment of ["production", "sandbox", "developer"]) {
    const f = await fixture(t, { region, environment }); const started = await f.start();
    assert.equal(started.url.origin, f.accounts);
    await f.service.completeAuthorization({ ...args, callbackUrl: started.callbackUrl });
    await f.service.invoke({ ...args, operation: "accounts.list" });
    assert.equal(f.requests.at(-1).url.origin, f.api);
  }
});

test("Zoho CRM reads typed field selections and bounded pages without following cursors automatically", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const operation of ["leads.list", "contacts.list", "accounts.list", "deals.list"]) {
    const result = await f.service.invoke({ ...args, operation, input: { per_page: 2, page: 10, fields: "id,Custom_Field" } });
    assert.equal(result.data[0].Email, null); assert.equal(result.info.next_page_token, "fixture-next");
    assert.equal(f.requests.at(-1).url.searchParams.get("fields"), "id,Custom_Field");
  }
  await f.service.invoke({ ...args, operation: "leads.list", input: { page_token: "fixture-next", per_page: 2, fields: "id,Custom_Field" } });
  assert.equal(f.requests.at(-1).url.searchParams.has("page"), false);
  assert.equal(f.requests.length, 7);
  f.state.status = 204;
  assert.deepEqual(await f.service.invoke({ ...args, operation: "leads.list" }), { data: [], info: { count: 0, per_page: 100, more_records: false } });
});

test("Zoho CRM rejects ambiguous paging, arbitrary URLs, oversized fields and unknown writes before transport", async (t) => {
  const f = await fixture(t); await f.connect(); const before = f.requests.length;
  for (const input of [{ page: 0 }, { page: 11 }, { page: 1.5 }, { per_page: 201 }, { per_page: 0 }, { page: 1, page_token: "next" },
    { page_token: " " }, { page_token: "a".repeat(4097) }, { fields: "Email,Email" }, { fields: "../Secrets" },
    { fields: Array.from({ length: 51 }, (_, i) => `Field_${i}`).join(",") }, { url: "https://invalid.test" }, { module: "Users" }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "leads.list", input }), { code: "connector_input_invalid" });
  }
  await assert.rejects(f.service.invoke({ ...args, operation: "users.current", input: { type: "AllUsers" } }), { code: "connector_input_invalid" });
  await assert.rejects(f.service.invoke({ ...args, operation: "leads.create" }), { code: "connector_operation_unknown" });
  assert.equal(f.requests.length, before);
});

test("Zoho CRM honors reduced scopes and full-module grants without cross-user connection reuse", async (t) => {
  const f = await fixture(t, { region: "us", environment: "production" }, ["ZohoCRM.users.READ"]); await f.connect();
  await assert.rejects(f.service.invoke({ ...args, operation: "leads.list" }), { code: "connector_scope_missing" });
  for (const owner of [{ ...context, applicationId: "other" }, { ...context, subjectId: "other" }]) {
    await assert.rejects(f.service.invoke({ ...args, context: owner, operation: "users.current" }), { code: "connector_reconnect_required" });
  }
  const denied = createConnectionService({ ...f.options, authorize: async () => null });
  await assert.rejects(denied.invoke({ ...args, operation: "users.current" }), { code: "connector_access_denied" });
  assert.equal(f.requests.length, 2);
  const all = await fixture(t, { region: "us", environment: "production" }, ["ZohoCRM.users.ALL", "ZohoCRM.modules.ALL"]);
  await all.connect(); await all.service.invoke({ ...args, operation: "deals.list" });
});

test("Zoho CRM refresh retains the original refresh token and scopes across restart and failed reads", async (t) => {
  const f = await fixture(t); await f.connect(); f.state.time += 40_000;
  await Promise.all([f.service.invoke({ ...args, operation: "users.current" }), f.service.invoke({ ...args, operation: "users.current" })]);
  assert.equal(f.state.count, 2);
  f.state.time += 40_000; f.state.status = 429;
  await assert.rejects(f.service.invoke({ ...args, operation: "users.current" }), { code: "connector_rate_limited" });
  f.state.status = 200;
  const restarted = createConnectionService(f.options); await restarted.invoke({ ...args, operation: "users.current" });
  assert.equal(f.state.count, 3); assert.deepEqual((await restarted.status(args)).grantedScopes, scopes);
  f.state.time += 40_000;
  await restarted.invoke({ ...args, operation: "leads.list" }); assert.equal(f.state.count, 4);
});

test("Zoho CRM rejects tokens for a wrong or missing API domain and never follows callback-supplied hosts", async (t) => {
  for (const domain of [undefined, "https://www.zohoapis.eu", "https://sandbox.zohoapis.com", "https://www.zohoapis.com.attacker.test", "https://www.zohoapis.com/path"]) {
    const f = await fixture(t); f.state.tokenValue = { access_token: "unused", token_type: "Bearer", expires_in: 3600, api_domain: domain };
    const start = await f.start(); const redirect = new URL(start.callbackUrl); redirect.searchParams.set("accounts-server", "https://attacker.test");
    await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: redirect.href }), { code: "connector_response_invalid" });
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url.origin, f.accounts);
  }
  const f = await fixture(t); await f.connect(); f.state.time += 40_000;
  f.state.tokenValue = { error: "invalid_code", error_description: "sensitive provider text" };
  await assert.rejects(f.service.invoke({ ...args, operation: "users.current" }), { code: "connector_reconnect_required" });
  assert.equal((await f.service.status(args)).status, "reconnect-required");
});

test("Zoho CRM settings changes require reconnect and consent denial, cancellation and replay preserve saved grants", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const change of [{ region: "eu" }, { environment: "sandbox" }]) {
    const configuration = structuredClone(f.options.configuration); Object.assign(configuration.integrations.crm.settings, change);
    await assert.rejects(createConnectionService({ ...f.options, configuration }).invoke({ ...args, operation: "users.current" }), { code: "connector_reconnect_required" });
  }
  const start = await f.start(); const denied = new URL(start.callbackUrl); denied.searchParams.delete("code"); denied.searchParams.set("error", "access_denied");
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: denied.href }), { code: "connector_consent_denied" });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: start.callbackUrl }), { code: "connector_attempt_invalid" });
  const pending = await f.start(); await f.service.cancelAuthorization({ ...args, state: pending.url.searchParams.get("state") });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: pending.callbackUrl }), { code: "connector_attempt_invalid" });
  assert.equal((await f.service.status(args)).status, "connected");
  await f.service.disconnect(args); assert.equal((await f.service.status(args)).status, "disconnected");
  assert.equal(f.requests.length, 2);
});

test("Zoho CRM maps provider errors and rejects malformed successes without leaking provider text", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const [status, value, code] of [[403, { message: "sensitive provider text" }, "connector_permission_denied"],
    [404, {}, "connector_resource_not_found"], [500, {}, "connector_provider_failed"], [429, {}, "connector_rate_limited"],
    [401, { code: "OAUTH_SCOPE_MISMATCH" }, "connector_scope_missing"]]) {
    f.state.status = status; f.state.value = value;
    await assert.rejects(f.service.invoke({ ...args, operation: "leads.list" }), (error) => error.code === code && !error.message.includes("sensitive"));
  }
  f.state.status = 200;
  for (const value of [null, "invalid json", {}, { status: "error", code: "BAD_REQUEST" }, { data: [{ id: 123 }], info: { count: 1, per_page: 100, page: 1, more_records: false } },
    { data: [], info: { count: 0, per_page: 100, page: 2, more_records: false } }, { data: [], info: { count: 1, per_page: 100, page: 1, more_records: false } }]) {
    f.state.value = value;
    await assert.rejects(f.service.invoke({ ...args, operation: "leads.list" }), { code: "connector_response_invalid" });
  }
  f.state.value = undefined; f.state.status = 204;
  await assert.rejects(f.service.invoke({ ...args, operation: "users.current" }), { code: "connector_response_invalid" });
  f.state.status = 401;
  await assert.rejects(f.service.invoke({ ...args, operation: "users.current" }), { code: "connector_reconnect_required" });
});

test("Zoho CRM delivers cancellation and timeout to the provider without replay", async (t) => {
  const f = await fixture(t); await f.connect(); f.state.hang = true;
  const abort = new AbortController(); const result = f.service.invoke({ ...args, operation: "leads.list", signal: abort.signal });
  setTimeout(() => abort.abort(), 10);
  await assert.rejects(result, { code: "connector_cancelled" });
  await assert.rejects(f.service.invoke({ ...args, operation: "leads.list" }), { code: "connector_provider_timeout" });
  assert.equal(f.requests.length, 4);
});

test("Zoho CRM guide uses the shared configuration schema and rejects invalid regions or raw secrets", async () => {
  const guide = await readFile(new URL("../docs/zoho-crm.md", import.meta.url), "utf8");
  const json = guide.match(/```json\n([\s\S]*?)\n```/u)[1];
  const configuration = parseIntegrationConfiguration(json, { providers: [zohoCrmProvider] });
  assert.equal(configuration.integrations.crm.settings.region, "eu");
  for (const [field, value] of [["region", "attacker.test"], ["environment", "anything"]]) {
    const invalid = JSON.parse(json); invalid.integrations.crm.settings[field] = value;
    assert.throws(() => parseIntegrationConfiguration(JSON.stringify(invalid), { providers: [zohoCrmProvider] }));
  }
  const invalid = JSON.parse(json); invalid.registrations.zoho.clientSecretRef = "raw-secret";
  assert.throws(() => parseIntegrationConfiguration(JSON.stringify(invalid), { providers: [zohoCrmProvider] }));
});
