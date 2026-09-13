import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { zohoBooksProvider } from "../src/server/zoho-books.js";

const context = { applicationId: "application-one", subjectId: "user-one" };
const args = { context, integrationId: "books" };
const callback = "https://app.example.test/oauth/zoho-books/callback";
const scopes = ["ZohoBooks.settings.READ", "ZohoBooks.contacts.READ", "ZohoBooks.invoices.READ"];
const org = "10234695";
const organizations = { code: 0, message: "success", organizations: [
  { organization_id: "10234694", name: "Other organisation", is_default_org: true, is_org_active: true },
  { organization_id: org, name: "Chosen organisation", is_default_org: false, is_org_active: true }
] };
const regions = {
  us: ["https://accounts.zoho.com", "com"], eu: ["https://accounts.zoho.eu", "eu"],
  in: ["https://accounts.zoho.in", "in"], au: ["https://accounts.zoho.com.au", "com.au"],
  jp: ["https://accounts.zoho.jp", "jp"], ca: ["https://accounts.zohocloud.ca", "ca"],
  cn: ["https://accounts.zoho.com.cn", "com.cn"], sa: ["https://accounts.zoho.sa", "sa"]
};

async function fixture(t, settings = { region: "eu" }, selectedScopes = scopes) {
  const directory = await mkdtemp(path.join(tmpdir(), "zoho-books-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const [accounts, suffix] = regions[settings.region || "eu"];
  const api = `https://www.zohoapis.${suffix}`;
  const state = { time: Date.now(), count: 0, status: 200, value: undefined, tokenValue: undefined, hang: false };
  const requests = [];
  const configuration = { schemaVersion: 1, registrations: { zoho: { source: "own", clientId: "fixture-books-client", clientSecretRef: "env:BOOKS_SECRET", callbackUrlRef: "env:BOOKS_CALLBACK" } },
    integrations: { books: { provider: "zoho-books", accountMode: "per-user", settings, scopes: selectedScopes, authentication: { method: "oauth2", registrationRef: "zoho" } } } };
  const options = {
    configuration, providers: [{ ...zohoBooksProvider, requestTimeoutMs: 50 }], authorize: async (owner) => owner,
    now: () => state.time, resolveReference: async (ref) => ({ "env:BOOKS_SECRET": "fixture-client-secret", "env:BOOKS_CALLBACK": callback })[ref],
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current" }) }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)); requests.push({ url, init });
      if (url.origin === accounts) {
        assert.equal(url.pathname, "/oauth/v2/token"); assert.equal(url.search, ""); assert.equal(init.method, "POST");
        assert.match(new Headers(init.headers).get("content-type"), /application\/x-www-form-urlencoded/u);
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), "fixture-books-client"); assert.equal(body.get("client_secret"), "fixture-client-secret");
        if (body.get("grant_type") === "authorization_code") {
          assert.equal(body.get("redirect_uri"), callback); assert.ok(body.get("code_verifier"));
        } else {
          assert.equal(body.get("grant_type"), "refresh_token"); assert.equal(body.get("refresh_token"), "fixture-refresh-token");
        }
        state.count += 1;
        return Response.json(state.tokenValue ?? { access_token: `fixture-access-${state.count}`, ...(state.count === 1 ? { refresh_token: "fixture-refresh-token" } : {}),
          token_type: "Bearer", api_domain: api, expires_in: 60 });
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
      const resource = url.pathname.split("/").at(-1);
      const value = resource === "organizations" ? organizations : { code: 0, message: "success",
        [resource]: [{ [resource === "contacts" ? "contact_id" : "invoice_id"]: "460000000026049", notes: null }],
        page_context: { page: Number(url.searchParams.get("page")), per_page: Number(url.searchParams.get("per_page")), has_more_page: true } };
      if (resource === "invoices") value.page_context = [value.page_context];
      return Response.json(state.value === undefined ? value : state.value, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  const start = async () => {
    const { authorizationUrl } = await service.beginAuthorization(args); const url = new URL(authorizationUrl);
    const redirect = new URL(callback); redirect.searchParams.set("code", "fixture-code"); redirect.searchParams.set("state", url.searchParams.get("state"));
    redirect.searchParams.set("accounts-server", "https://attacker.test");
    return { url, callbackUrl: redirect.href };
  };
  const connect = async () => service.completeAuthorization({ ...args, callbackUrl: (await start()).callbackUrl });
  return { directory, service, options, state, requests, start, connect, api, accounts };
}

test("Zoho Books uses regional PKCE consent and persists verified credentials in encrypted files", async (t) => {
  const f = await fixture(t); const start = await f.start();
  assert.equal(start.url.origin, "https://accounts.zoho.eu"); assert.equal(start.url.pathname, "/oauth/v2/auth");
  assert.equal(start.url.searchParams.get("scope"), scopes.join(","));
  assert.equal(start.url.searchParams.get("access_type"), "offline"); assert.equal(start.url.searchParams.get("prompt"), "consent");
  assert.equal(start.url.searchParams.get("code_challenge_method"), "S256"); assert.equal(start.url.searchParams.has("client_secret"), false);
  await f.service.completeAuthorization({ ...args, callbackUrl: start.callbackUrl });
  assert.equal(f.requests[1].url.pathname, "/books/v3/organizations"); assert.equal(f.requests[1].url.search, "");
  for (const name of await readdir(f.directory)) {
    const text = await readFile(path.join(f.directory, name), "utf8");
    for (const secret of ["fixture-code", "fixture-client-secret", "fixture-access-1", "fixture-refresh-token"]) assert.equal(text.includes(secret), false);
  }
  const restarted = createConnectionService(f.options);
  assert.equal((await restarted.status(args)).status, "connected");
  assert.deepEqual(await restarted.invoke({ ...args, operation: "organizations.list" }), organizations);
});

test("Zoho Books routes all eight data centers to fixed accounts and API hosts", async (t) => {
  for (const region of Object.keys(regions)) {
    const f = await fixture(t, { region }); const start = await f.start(); assert.equal(start.url.origin, f.accounts);
    await f.service.completeAuthorization({ ...args, callbackUrl: start.callbackUrl });
    await f.service.invoke({ ...args, operation: "invoices.list", input: { organization_id: org } });
    assert.equal(f.requests.at(-1).url.origin, f.api);
  }
});

test("Zoho Books requires an explicit organisation and never selects the first or default discovery result", async (t) => {
  const f = await fixture(t); await f.connect();
  await assert.rejects(f.service.invoke({ ...args, operation: "contacts.list" }), { code: "connector_input_invalid" });
  assert.equal(f.requests.length, 2);
  for (const operation of ["contacts.list", "invoices.list"]) {
    const result = await f.service.invoke({ ...args, operation, input: { organization_id: org, page: 2, per_page: 3 } });
    assert.equal(f.requests.at(-1).url.searchParams.get("organization_id"), org);
    assert.deepEqual(result.page_context, { page: 2, per_page: 3, has_more_page: true });
    assert.equal(result[operation.split(".")[0]][0].notes, null);
  }
  assert.equal(f.requests.length, 4);
  f.state.value = { code: 0, contacts: [], page_context: { page: 1, per_page: 100, has_more_page: false } };
  assert.deepEqual((await f.service.invoke({ ...args, operation: "contacts.list", input: { organization_id: org } })).contacts, []);
  f.state.value = { code: 0, invoices: [], page_context: { page: 1, per_page: 100, has_more_page: false } };
  assert.deepEqual((await f.service.invoke({ ...args, operation: "invoices.list", input: { organization_id: org } })).page_context, f.state.value.page_context);
});

test("Zoho Books validates configured organisation access, prevents overrides and allows empty unconfigured discovery", async (t) => {
  const f = await fixture(t, { region: "sa", organizationId: org }); await f.connect();
  await f.service.invoke({ ...args, operation: "contacts.list" });
  assert.equal(f.requests.at(-1).url.searchParams.get("organization_id"), org);
  await f.service.invoke({ ...args, operation: "contacts.list", input: { organization_id: org } });
  const before = f.requests.length;
  await assert.rejects(f.service.invoke({ ...args, operation: "contacts.list", input: { organization_id: "10234694" } }), { code: "connector_input_invalid" });
  assert.equal(f.requests.length, before);
  for (const entries of [[], [{ organization_id: org, name: "Inactive", is_org_active: false }], organizations.organizations.slice(0, 1)]) {
    const missing = await fixture(t, { region: "eu", organizationId: org }); missing.state.value = { code: 0, organizations: entries };
    await assert.rejects(missing.connect(), { code: "connector_permission_denied" });
    assert.equal((await missing.service.status(args)).status, "disconnected");
  }
  const empty = await fixture(t); empty.state.value = { code: 0, organizations: [] }; await empty.connect();
  assert.deepEqual((await empty.service.invoke({ ...args, operation: "organizations.list" })).organizations, []);
});

test("Zoho Books rejects invalid IDs, oversized pages and arbitrary requests before transport", async (t) => {
  const f = await fixture(t); await f.connect(); const before = f.requests.length;
  for (const input of [{ organization_id: "../secret" }, { organization_id: "001" }, { organization_id: "1&other=2" }, { organization_id: "1".repeat(31) },
    { organization_id: org, page: 0 }, { organization_id: org, page: 1.2 }, { organization_id: org, page: 1_000_001 },
    { organization_id: org, per_page: 0 }, { organization_id: org, per_page: 201 }, { organization_id: org, url: "https://invalid.test" }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "invoices.list", input }), { code: "connector_input_invalid" });
  }
  await assert.rejects(f.service.invoke({ ...args, operation: "organizations.list", input: { organization_id: org } }), { code: "connector_input_invalid" });
  await assert.rejects(f.service.invoke({ ...args, operation: "invoices.create" }), { code: "connector_operation_unknown" });
  assert.equal(f.requests.length, before);
});

test("Zoho Books enforces read or full scopes and isolates application and user owners", async (t) => {
  const f = await fixture(t, { region: "eu" }, ["ZohoBooks.settings.READ"]); await f.connect();
  await assert.rejects(f.service.invoke({ ...args, operation: "contacts.list", input: { organization_id: org } }), { code: "connector_scope_missing" });
  for (const owner of [{ ...context, applicationId: "other" }, { ...context, subjectId: "other" }]) {
    await assert.rejects(f.service.invoke({ ...args, context: owner, operation: "organizations.list" }), { code: "connector_reconnect_required" });
  }
  const denied = createConnectionService({ ...f.options, authorize: async () => null });
  await assert.rejects(denied.invoke({ ...args, operation: "organizations.list" }), { code: "connector_access_denied" });
  assert.equal(f.requests.length, 2);
  const full = await fixture(t, { region: "eu", organizationId: org }, ["ZohoBooks.settings.READ", "ZohoBooks.contacts.ALL", "ZohoBooks.invoices.ALL"]);
  await full.connect(); await full.service.invoke({ ...args, operation: "contacts.list" }); await full.service.invoke({ ...args, operation: "invoices.list" });
});

test("Zoho Books refresh retains tokens and scopes across restart and persists before a failed API request", async (t) => {
  const f = await fixture(t); await f.connect(); f.state.time += 40_000;
  await Promise.all([f.service.invoke({ ...args, operation: "organizations.list" }), f.service.invoke({ ...args, operation: "organizations.list" })]);
  assert.equal(f.state.count, 2); f.state.time += 40_000; f.state.status = 429;
  await assert.rejects(f.service.invoke({ ...args, operation: "organizations.list" }), { code: "connector_rate_limited" });
  f.state.status = 200;
  const restarted = createConnectionService(f.options); await restarted.invoke({ ...args, operation: "organizations.list" });
  assert.equal(f.state.count, 3); assert.deepEqual((await restarted.status(args)).grantedScopes, scopes);
  f.state.time += 40_000; f.state.tokenValue = { error: "invalid_code", error_description: "sensitive provider text" };
  await assert.rejects(restarted.invoke({ ...args, operation: "organizations.list" }), { code: "connector_reconnect_required" });
});

test("Zoho Books rejects token host substitution and binds saved connections to region and organisation settings", async (t) => {
  for (const api_domain of [undefined, "https://www.zohoapis.com", "https://www.zohoapis.eu.attacker.test", "https://www.zohoapis.eu/path"]) {
    const f = await fixture(t); f.state.tokenValue = { access_token: "unused", token_type: "Bearer", expires_in: 3600, api_domain };
    await assert.rejects(f.connect(), { code: "connector_response_invalid" }); assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url.origin, "https://accounts.zoho.eu");
  }
  const f = await fixture(t); await f.connect();
  for (const change of [{ region: "sa" }, { organizationId: org }]) {
    const configuration = structuredClone(f.options.configuration); Object.assign(configuration.integrations.books.settings, change);
    await assert.rejects(createConnectionService({ ...f.options, configuration }).invoke({ ...args, operation: "organizations.list" }), { code: "connector_reconnect_required" });
  }
});

test("Zoho Books denial, cancellation and callback replay preserve a previous grant; disconnect stays local", async (t) => {
  const f = await fixture(t); await f.connect();
  const start = await f.start(); const denied = new URL(start.callbackUrl); denied.searchParams.delete("code"); denied.searchParams.set("error", "access_denied");
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: denied.href }), { code: "connector_consent_denied" });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: start.callbackUrl }), { code: "connector_attempt_invalid" });
  const pending = await f.start(); await f.service.cancelAuthorization({ ...args, state: pending.url.searchParams.get("state") });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: pending.callbackUrl }), { code: "connector_attempt_invalid" });
  assert.equal((await f.service.status(args)).status, "connected");
  await f.service.disconnect(args); assert.equal((await f.service.status(args)).status, "disconnected"); assert.equal(f.requests.length, 2);
});

test("Zoho Books rejects error envelopes and mismatched pages and redacts provider failures", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const [status, code] of [[403, "connector_permission_denied"], [404, "connector_resource_not_found"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    f.state.status = status; f.state.value = { code: 45, message: "sensitive provider text" };
    await assert.rejects(f.service.invoke({ ...args, operation: "organizations.list" }), (error) => error.code === code && !error.message.includes("sensitive"));
  }
  f.state.status = 200;
  for (const value of [null, "invalid JSON", { code: 1000, message: "sensitive provider text" }, { code: 0 },
    { code: 0, contacts: [{ contact_id: 123 }], page_context: { page: 1, per_page: 100, has_more_page: false } },
    { code: 0, contacts: [], page_context: { page: 2, per_page: 100, has_more_page: false } },
    { code: 0, contacts: [], page_context: { page: 1, per_page: 101, has_more_page: false } },
    { code: 0, contacts: [], page_context: { page: 1, per_page: 100 } }]) {
    f.state.value = value;
    await assert.rejects(f.service.invoke({ ...args, operation: "contacts.list", input: { organization_id: org } }), { code: "connector_response_invalid" });
  }
  f.state.value = { code: 0, organizations: [{ organization_id: 1, name: "Invalid", is_org_active: true }] };
  await assert.rejects(f.service.invoke({ ...args, operation: "organizations.list" }), { code: "connector_response_invalid" });
  for (const page_context of [[], [{ page: 1, per_page: 100, has_more_page: false }, { page: 2, per_page: 100, has_more_page: false }], [null]]) {
    f.state.value = { code: 0, invoices: [], page_context };
    await assert.rejects(f.service.invoke({ ...args, operation: "invoices.list", input: { organization_id: org } }), { code: "connector_response_invalid" });
  }
  f.state.status = 204; await assert.rejects(f.service.invoke({ ...args, operation: "organizations.list" }), { code: "connector_response_invalid" });
  f.state.status = 401; await assert.rejects(f.service.invoke({ ...args, operation: "organizations.list" }), { code: "connector_reconnect_required" });
});

test("Zoho Books delivers cancellation and timeout without retrying", async (t) => {
  const f = await fixture(t); await f.connect(); f.state.hang = true;
  const abort = new AbortController(); const result = f.service.invoke({ ...args, operation: "organizations.list", signal: abort.signal });
  setTimeout(() => abort.abort(), 10);
  await assert.rejects(result, { code: "connector_cancelled" });
  await assert.rejects(f.service.invoke({ ...args, operation: "organizations.list" }), { code: "connector_provider_timeout" });
  assert.equal(f.requests.length, 4);
});

test("Zoho Books guide parses through shared validation and rejects unknown regions and raw credentials", async () => {
  const guide = await readFile(new URL("../docs/zoho-books.md", import.meta.url), "utf8");
  const json = guide.match(/```json\n([\s\S]*?)\n```/u)[1];
  const configuration = parseIntegrationConfiguration(json, { providers: [zohoBooksProvider] });
  assert.equal(configuration.integrations.books.settings.organizationId, org);
  const optional = JSON.parse(json); delete optional.integrations.books.settings.organizationId;
  assert.equal(parseIntegrationConfiguration(JSON.stringify(optional), { providers: [zohoBooksProvider] }).integrations.books.settings.organizationId, undefined);
  for (const change of [{ region: "anything" }, { organizationId: "not-digits" }, { organizationId: " " }, { environment: "sandbox" }]) {
    const invalid = JSON.parse(json); Object.assign(invalid.integrations.books.settings, change);
    assert.throws(() => parseIntegrationConfiguration(JSON.stringify(invalid), { providers: [zohoBooksProvider] }));
  }
  const invalid = JSON.parse(json); invalid.registrations.zoho.clientSecretRef = "raw-secret";
  assert.throws(() => parseIntegrationConfiguration(JSON.stringify(invalid), { providers: [zohoBooksProvider] }));
});
