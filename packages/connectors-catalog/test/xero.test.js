import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { validateIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { xeroProvider } from "../src/server/xero.js";

const tenantId = "70784a63-d24b-46a9-a4db-0e70a274b056";
const otherTenant = "e0da6937-de07-4a14-adee-37abfac298ce";
const recordId = "bd2270c3-8706-4c11-9cfb-000b551c3f51";
const callback = "https://app.example.test/connections/xero/callback";
const context = { applicationId: "app-one", subjectId: "user-one" };
const input = { context, integrationId: "xero" };
const connection = { id: recordId, tenantId, tenantType: "ORGANISATION", tenantName: "Fixture organisation" };
const defaults = xeroProvider.scopes.filter((scope) => scope.recommended).map((scope) => scope.value);

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "xero-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const state = { time: Date.now(), tokenCount: 0, tokenScope: defaults.join(" "), status: 200, connections: [connection],
    response: { Contacts: [{ ContactID: recordId, Name: "Customer & Co" }] }, tokenStatus: 200, deny: false, stall: false };
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(4) }, activeKeyId: "current" });
  const options = {
    configuration: { schemaVersion: 1, integrations: { xero: { provider: "xero", accountMode: "per-user", scopes: defaults,
      authentication: { method: "oauth2", registrationRef: "xero" } } },
    registrations: { xero: { source: "own", tokenEndpointAuthMethod: "client_secret_basic", clientId: "fixture-client",
      clientSecretRef: "env:XERO_SECRET", callbackUrlRef: "env:XERO_CALLBACK" } } },
    providers: [xeroProvider], authorize: async (owner) => { if (state.deny) throw new Error("Denied by host"); return owner; }, now: () => state.time,
    resolveReference: async (ref) => { if (ref === "env:XERO_CALLBACK") return callback; if (ref === "env:XERO_SECRET") return "fixture-client-secret"; throw new Error("Missing reference"); },
    store: createFileConnectionStore({ directory, protection }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address));
      const headers = new Headers(init.headers);
      requests.push({ url, init, headers });
      if (url.origin === "https://identity.xero.com") {
        assert.equal(init.redirect, "manual");
        assert.equal(url.pathname, "/connect/token");
        assert.ok(headers.get("authorization").startsWith("Basic "));
        const credentials = Buffer.from(headers.get("authorization").slice(6), "base64").toString().split(":").map(decodeURIComponent);
        assert.deepEqual(credentials, ["fixture-client", "fixture-client-secret"]);
        const body = new URLSearchParams(init.body);
        assert.equal(body.has("client_secret"), false);
        if (body.get("grant_type") === "refresh_token") assert.equal(body.get("refresh_token"), `fixture-refresh-${state.tokenCount}`);
        if (state.tokenStatus !== 200) return Response.json({ error: "invalid_grant", error_description: "fixture-client-secret" }, { status: state.tokenStatus });
        state.tokenCount += 1;
        return Response.json({ access_token: `fixture-access-${state.tokenCount}`, refresh_token: `fixture-refresh-${state.tokenCount}`, token_type: "Bearer", expires_in: 60, scope: state.tokenScope });
      }
      assert.equal(url.origin, "https://api.xero.com");
      assert.equal(init.redirect, "error");
      assert.equal(headers.get("authorization"), `Bearer fixture-access-${state.tokenCount}`);
      if (state.stall) return new Promise((resolve, reject) => { init.signal.throwIfAborted(); init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }); });
      if (url.pathname === "/connections") {
        assert.equal(headers.has("xero-tenant-id"), false);
        return Response.json(state.connections, { status: state.status });
      }
      assert.equal(headers.get("xero-tenant-id"), tenantId);
      if (state.binaryResponse !== undefined) return new Response(state.binaryResponse, { status: state.accountingStatus ?? state.status, headers: { "content-type": "application/pdf" } });
      return Response.json(state.response, { status: state.accountingStatus ?? state.status });
    }
  };
  const service = createConnectionService(options);
  async function start() {
    const { authorizationUrl } = await service.beginAuthorization(input);
    const url = new URL(authorizationUrl);
    const redirect = new URL(callback);
    redirect.searchParams.set("code", "fixture-code"); redirect.searchParams.set("state", url.searchParams.get("state"));
    return { url, callbackUrl: redirect.href };
  }
  const connect = async () => service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  return { service, options, state, directory, protection, requests, start, connect };
}

test("Xero exchanges code with Basic authentication, discovers tenants and persists an isolated encrypted grant", async (t) => {
  const f = await fixture(t); const { url, callbackUrl } = await f.start();
  assert.equal(url.origin + url.pathname, "https://login.xero.com/identity/connect/authorize");
  assert.equal(url.searchParams.get("response_type"), "code"); assert.equal(url.searchParams.get("redirect_uri"), callback);
  assert.equal(url.searchParams.get("scope"), defaults.join(" ")); assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.has("client_secret"), false); assert.equal(url.searchParams.has("openid"), false);
  const connected = await f.service.completeAuthorization({ ...input, callbackUrl });
  assert.equal(connected.status, "connected"); assert.deepEqual(connected.grantedScopes, defaults);
  const code = new URLSearchParams(f.requests[0].init.body);
  assert.equal(code.get("grant_type"), "authorization_code"); assert.equal(code.get("redirect_uri"), callback); assert.ok(code.get("code_verifier"));
  assert.equal(f.requests[1].url.href, "https://api.xero.com/connections");
  for (const file of await readdir(f.directory)) {
    const value = await readFile(path.join(f.directory, file), "utf8");
    for (const secret of ["fixture-client-secret", "fixture-access-1", "fixture-refresh-1"]) assert.equal(value.includes(secret), false);
  }
  const restarted = createConnectionService({ ...f.options, store: createFileConnectionStore({ directory: f.directory, protection: f.protection }) });
  assert.deepEqual(await restarted.status(input), { ...connected, callbackUrl: callback });
  assert.deepEqual(await restarted.invoke({ ...input, operation: "connections.list" }), [connection]);
  for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-user" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "connections.list" }), { code: "connector_reconnect_required" });
  }
  const count = f.requests.length; await restarted.disconnect(input);
  assert.equal(f.requests.length, count); assert.equal((await f.service.status(input)).status, "disconnected");
});

test("Xero configuration supports captured permissions plus read variants and requires a Basic own registration", async (t) => {
  const f = await fixture(t); const config = f.options.configuration;
  assert.equal(xeroProvider.scopes.length, 24); assert.equal(new Set(xeroProvider.scopes.map((s) => s.value)).size, 24);
  for (const accountMode of xeroProvider.accountModes) {
    const copy = structuredClone(config); copy.integrations.xero.accountMode = accountMode;
    copy.integrations.xero.scopes = xeroProvider.scopes.map((s) => s.value);
    assert.deepEqual(validateIntegrationConfiguration(copy, { providers: [xeroProvider] }), copy);
  }
  for (const method of [undefined, "client_secret_post", "none", "unknown"]) {
    const copy = structuredClone(config); copy.registrations.xero.tokenEndpointAuthMethod = method;
    assert.throws(() => validateIntegrationConfiguration(copy, { providers: [xeroProvider] }));
  }
  for (const ref of ["raw-secret", "https://paste.invalid/secret", ""]) {
    const copy = structuredClone(config); copy.registrations.xero.clientSecretRef = ref;
    assert.throws(() => validateIntegrationConfiguration(copy, { providers: [xeroProvider] }));
  }
  const copy = structuredClone(config); copy.registrations.xero.source = "managed";
  delete copy.registrations.xero.clientId; delete copy.registrations.xero.clientSecretRef; delete copy.registrations.xero.callbackUrlRef; delete copy.registrations.xero.tokenEndpointAuthMethod;
  Object.assign(copy.registrations.xero, { serviceUrlRef: "env:GATEWAY", serviceCredentialRef: "env:APP", assignmentRef: "paid" });
  assert.throws(() => createConnectionService({ ...f.options, configuration: copy }), { code: "integration_configuration_invalid" });
});

test("Xero checks current organisation permission before every accounting request and leaves discovery unscoped", async (t) => {
  const f = await fixture(t); await f.connect();
  f.state.connections = [connection, { ...connection, id: otherTenant, tenantId: otherTenant, tenantType: "PRACTICEMANAGER", tenantName: null },
    { ...connection, id: "74305bf3-12e0-45e2-8dc8-e3ec73e3b1f9", tenantId: "74305bf3-12e0-45e2-8dc8-e3ec73e3b1f9", tenantType: "PRACTICE" }];
  const operation = { ...input, operation: "contacts.list", input: { tenantId } };
  assert.deepEqual(await f.service.invoke(operation), f.state.response);
  assert.equal(f.requests.at(-2).url.pathname, "/connections");
  assert.equal(f.requests.at(-1).headers.get("xero-tenant-id"), tenantId);
  for (const denied of [otherTenant, "74305bf3-12e0-45e2-8dc8-e3ec73e3b1f9", "00000000-0000-0000-0000-000000000000"]) {
    const count = f.requests.length;
    await assert.rejects(f.service.invoke({ ...operation, input: { tenantId: denied } }), { code: "connector_permission_denied" });
    assert.equal(f.requests.length, count + 1); assert.equal(f.requests.at(-1).url.pathname, "/connections");
  }
  f.state.connections = []; const count = f.requests.length;
  await assert.rejects(f.service.invoke(operation), { code: "connector_permission_denied" });
  assert.equal(f.requests.length, count + 1);
  assert.deepEqual(await f.service.invoke({ ...input, operation: "connections.list" }), []);
});

test("Xero read operations use exact tenant headers, bounded lightweight pages and encoded search", async (t) => {
  const f = await fixture(t); await f.connect();
  const result = await f.service.invoke({ ...input, operation: "contacts.list", input: { tenantId: tenantId.toUpperCase(), page: 2, pageSize: 1, includeArchived: true, searchTerm: "ACME + & Sons" } });
  assert.deepEqual(result, f.state.response);
  assert.deepEqual(Object.fromEntries(f.requests.at(-1).url.searchParams), { page: "2", pageSize: "1", includeArchived: "true", searchTerm: "ACME + & Sons", summaryOnly: "true" });
  f.state.response = { Invoices: [{ InvoiceID: recordId, InvoiceNumber: "INV-001", Status: "AUTHORISED" }] };
  assert.deepEqual(await f.service.invoke({ ...input, operation: "invoices.list", input: { tenantId } }), f.state.response);
  assert.deepEqual(Object.fromEntries(f.requests.at(-1).url.searchParams), { page: "1", pageSize: "100", summaryOnly: "true" });
  f.state.response = { Organisations: [{ OrganisationID: tenantId, Name: "Fixture organisation", BaseCurrency: "AUD" }] };
  assert.deepEqual(await f.service.invoke({ ...input, operation: "organisation.read", input: { tenantId } }), f.state.response);
  assert.equal(f.requests.at(-1).url.search, ""); assert.equal(f.requests.at(-1).url.pathname, "/api.xro/2.0/Organisation");
  f.state.response = { Contacts: [] };
  assert.deepEqual(await f.service.invoke({ ...input, operation: "contacts.list", input: { tenantId, page: 3 } }), { Contacts: [] });
});

test("Xero rejects bad tenant IDs, paging and arbitrary headers before provider requests", async (t) => {
  const f = await fixture(t); await f.connect(); const count = f.requests.length;
  for (const values of [{}, { tenantId: "" }, { tenantId: tenantId + "\r\nxero: 1" }, { tenantId, page: 0 }, { tenantId, page: 1.1 },
    { tenantId, pageSize: 201 }, { tenantId, pageSize: 0 }, { tenantId, page: 1_000_001 }, { tenantId, url: "https://evil.invalid" },
    { tenantId, headers: { Authorization: "evil" } }, { tenantId, summaryOnly: false }, { tenantId, searchTerm: "x".repeat(256) }]) {
    await assert.rejects(f.service.invoke({ ...input, operation: "contacts.list", input: values }), { code: "connector_input_invalid" });
  }
  await assert.rejects(f.service.invoke({ ...input, operation: "connections.list", input: { authEventId: "untrusted" } }), { code: "connector_input_invalid" });
  assert.equal(f.requests.length, count);
});

test("Xero serializes refresh rotation, persists reduced grants and retains new tokens after API failure", async (t) => {
  const f = await fixture(t); await f.connect(); f.state.time += 40_000;
  await Promise.all([f.service.invoke({ ...input, operation: "connections.list" }), f.service.invoke({ ...input, operation: "connections.list" })]);
  assert.equal(f.state.tokenCount, 2);
  f.state.tokenScope = "offline_access accounting.contacts.read"; f.state.time += 40_000; f.state.status = 429;
  await assert.rejects(f.service.invoke({ ...input, operation: "contacts.list", input: { tenantId } }), { code: "connector_rate_limited" });
  assert.equal(f.state.tokenCount, 3); f.state.status = 200;
  const restarted = createConnectionService(f.options);
  assert.deepEqual((await restarted.status(input)).grantedScopes, ["offline_access", "accounting.contacts.read"]);
  await restarted.invoke({ ...input, operation: "contacts.list", input: { tenantId } });
  assert.equal(f.state.tokenCount, 3);
  const count = f.requests.length;
  await assert.rejects(restarted.invoke({ ...input, operation: "invoices.list", input: { tenantId } }), { code: "connector_scope_missing" });
  assert.equal(f.requests.length, count);
  f.state.time += 40_000; f.state.tokenStatus = 400;
  await assert.rejects(restarted.invoke({ ...input, operation: "connections.list" }), { code: "connector_reconnect_required" });
  assert.equal((await restarted.status(input)).status, "reconnect-required");
});

test("Xero consent cancellation, denied scopes and registration changes cannot reuse attempts or grants", async (t) => {
  const f = await fixture(t); const cancelled = await f.start();
  await f.service.cancelAuthorization({ ...input, state: cancelled.url.searchParams.get("state") });
  await assert.rejects(f.service.completeAuthorization({ ...input, callbackUrl: cancelled.callbackUrl }), { code: "connector_attempt_invalid" });
  const denied = await f.start(); const deniedUrl = new URL(denied.callbackUrl); deniedUrl.searchParams.delete("code"); deniedUrl.searchParams.set("error", "access_denied");
  await assert.rejects(f.service.completeAuthorization({ ...input, callbackUrl: deniedUrl.href }), { code: "connector_consent_denied" });
  assert.equal(f.requests.length, 0);
  f.state.tokenScope = "offline_access"; await f.connect();
  const count = f.requests.length;
  await assert.rejects(f.service.invoke({ ...input, operation: "contacts.list", input: { tenantId } }), { code: "connector_scope_missing" });
  assert.equal(f.requests.length, count);
  const pending = await f.start(); const changed = structuredClone(f.options.configuration); changed.registrations.xero.clientId = "other-client";
  const service = createConnectionService({ ...f.options, configuration: changed });
  assert.equal((await service.status(input)).status, "reconnect-required");
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: pending.callbackUrl }), { code: "connector_attempt_invalid" });
  assert.equal(f.requests.length, count);
});

test("Xero accepts read-only or full accounting scopes and applies host authorization before references or HTTP", async (t) => {
  const f = await fixture(t); const config = structuredClone(f.options.configuration);
  config.integrations.xero.scopes = ["offline_access", "accounting.contacts", "accounting.invoices", "accounting.settings"];
  f.state.tokenScope = config.integrations.xero.scopes.join(" ");
  const service = createConnectionService({ ...f.options, configuration: config });
  const started = await service.beginAuthorization(input);
  await service.completeAuthorization({ ...input, callbackUrl: `${callback}?code=fixture&state=${new URL(started.authorizationUrl).searchParams.get("state")}` });
  await service.invoke({ ...input, operation: "contacts.list", input: { tenantId } });
  f.state.deny = true; const count = f.requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "contacts.list", input: { tenantId } }), /Denied by host/);
  await assert.rejects(service.beginAuthorization(input), /Denied by host/); assert.equal(f.requests.length, count);
});

test("Xero rejects malformed connections, foreign organisation results and overlong pages", async (t) => {
  const f = await fixture(t);
  for (const connections of [{}, [{}], [{ ...connection, id: null }], [{ ...connection, tenantId: "bad" }], [{ ...connection, tenantName: {} }]]) {
    f.state.connections = connections;
    await assert.rejects(f.connect(), { code: "connector_response_invalid" });
    assert.equal((await f.service.status(input)).status, "disconnected");
  }
  f.state.connections = [connection]; await f.connect();
  for (const response of [{ Contacts: [{}] }, { Contacts: {} }, { ErrorNumber: 10, Message: "fixture-client-secret" }, { Contacts: [{ ContactID: recordId }, { ContactID: recordId }] }]) {
    f.state.response = response;
    await assert.rejects(f.service.invoke({ ...input, operation: "contacts.list", input: { tenantId, pageSize: 1 } }), { code: "connector_response_invalid" });
  }
  f.state.response = { Organisations: [{ OrganisationID: otherTenant }] };
  await assert.rejects(f.service.invoke({ ...input, operation: "organisation.read", input: { tenantId } }), { code: "connector_response_invalid" });
  f.state.connections = [{ ...connection, tenantId: null }]; const count = f.requests.length;
  await assert.rejects(f.service.invoke({ ...input, operation: "contacts.list", input: { tenantId } }), { code: "connector_response_invalid" });
  assert.equal(f.requests.length, count + 1);
});

test("Xero errors are redacted, never retried and require reconnect after authentication failure", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"], [401, "connector_reconnect_required"]]) {
    f.state.status = status; f.state.connections = { Message: "fixture-client-secret" }; const count = f.requests.length;
    await assert.rejects(f.service.invoke({ ...input, operation: "connections.list" }), (error) => {
      assert.equal(error.code, code); assert.equal(JSON.stringify(error).includes("fixture-client-secret"), false); return true;
    });
    assert.equal(f.requests.length, count + 1);
  }
  assert.equal((await f.service.status(input)).status, "reconnect-required");
});

test("Xero interruption and timeout stop before the accounting call and keep the connection usable", async (t) => {
  const f = await fixture(t); await f.connect(); f.state.stall = true;
  const service = createConnectionService({ ...f.options, providers: [{ ...xeroProvider, requestTimeoutMs: 35 }] });
  const count = f.requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "contacts.list", input: { tenantId } }));
  assert.equal(f.requests.length, count + 1); assert.equal(f.requests.at(-1).url.pathname, "/connections");
  const controller = new AbortController();
  const pending = f.service.invoke({ ...input, operation: "contacts.list", input: { tenantId }, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 35);
  await assert.rejects(pending); clearTimeout(timer);
  assert.equal(f.requests.length, count + 2); assert.equal((await f.service.status(input)).status, "connected");
});

test("Xero payment pages preserve amounts and invoice references and enforce current tenant access", async (t) => {
  const f = await fixture(t);
  const scopes = [...defaults, "accounting.payments.read"];
  f.options.configuration.integrations.xero.scopes = scopes;
  f.state.tokenScope = scopes.join(" ");
  const service = createConnectionService(f.options);
  const { authorizationUrl } = await service.beginAuthorization(input);
  const url = new URL(callback); url.searchParams.set("code", "fixture-code");
  url.searchParams.set("state", new URL(authorizationUrl).searchParams.get("state"));
  await service.completeAuthorization({ ...input, callbackUrl: url.href });
  f.state.response = { Payments: [{ PaymentID: recordId, Amount: 12.34, Status: "AUTHORISED", CurrencyRate: 1.23,
    Invoice: { InvoiceID: otherTenant, CurrencyCode: "AUD" }, Account: { AccountID: recordId } }] };
  const args = { ...input, operation: "payments.list", input: { tenantId, page: 2, pageSize: 5 } };
  assert.deepEqual(await service.invoke(args), f.state.response);
  assert.equal(f.requests.at(-1).url.pathname, "/api.xro/2.0/Payments");
  assert.equal(f.requests.at(-1).url.search, "?page=2&pageSize=5");
  assert.equal(f.requests.at(-2).url.pathname, "/connections");
  const before = f.requests.length;
  await assert.rejects(service.invoke({ ...args, input: { tenantId, pageSize: 101 } }));
  assert.equal(f.requests.length, before);
  f.state.response = { Payments: Array(6).fill(f.state.response.Payments[0]) };
  await assert.rejects(service.invoke(args), { code: "connector_response_invalid" });
  f.state.response = { Payments: [{ PaymentID: recordId, Amount: "unknown", Status: "AUTHORISED" }] };
  await assert.rejects(service.invoke(args), { code: "connector_response_invalid" });
  f.state.response = { Payments: [] }; assert.deepEqual(await service.invoke(args), f.state.response);
  f.state.connections = [];
  const count = f.requests.length;
  await assert.rejects(service.invoke(args), { code: "connector_permission_denied" });
  assert.equal(f.requests.length, count + 1);
});

test("Xero financial reports retain nested rows and decimal text with explicit dates and report scopes", async (t) => {
  const f = await fixture(t);
  const scopes = [...defaults, "accounting.reports.profitandloss.read", "accounting.reports.balancesheet.read"];
  f.options.configuration.integrations.xero.scopes = scopes; f.state.tokenScope = scopes.join(" ");
  const service = createConnectionService(f.options);
  const { authorizationUrl } = await service.beginAuthorization(input);
  const url = new URL(callback); url.searchParams.set("code", "fixture-code");
  url.searchParams.set("state", new URL(authorizationUrl).searchParams.get("state"));
  await service.completeAuthorization({ ...input, callbackUrl: url.href });
  const cases = [
    ["reports.profitAndLoss", "ProfitAndLoss", { fromDate: "2026-01-01", toDate: "2026-08-31", periods: 2, timeframe: "MONTH", paymentsOnly: false }],
    ["reports.balanceSheet", "BalanceSheet", { date: "2026-08-31", standardLayout: true }]
  ];
  for (const [operation, name, fields] of cases) {
    f.state.response = { Reports: [{ ReportID: name, ReportTitles: [name], Rows: [
      { RowType: "Header", Cells: [{ Value: "Account" }, { Value: "August" }] },
      { RowType: "Section", Title: "Revenue", Rows: [{ RowType: "Row", Cells: [{ Value: "Sales" }, { Value: "9007199254740993.12", Attributes: [{ Id: "account", Value: recordId }] }] }] }
    ] }] };
    const args = { ...input, operation, input: { tenantId, ...fields } };
    assert.deepEqual(await service.invoke(args), f.state.response);
    const request = f.requests.at(-1);
    assert.equal(request.url.pathname, `/api.xro/2.0/Reports/${name}`);
    assert.deepEqual(Object.fromEntries(request.url.searchParams), Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)])));
    const count = f.requests.length;
    await assert.rejects(service.invoke({ ...args, input: { ...args.input, periods: 13 } }));
    assert.equal(f.requests.length, count);
    f.state.response = { Reports: [{ ReportID: name, Rows: [] }] };
    assert.deepEqual(await service.invoke(args), f.state.response);
    f.state.response = { Reports: [{ ReportID: name, Rows: [{ RowType: "Row", Cells: [{ Value: 42 }] }] }] };
    await assert.rejects(service.invoke(args), { code: "connector_response_invalid" });
  }
  const count = f.requests.length;
  for (const fields of [{ fromDate: "2026-02-30", toDate: "2026-03-31" }, { fromDate: "2026-10-01", toDate: "2026-09-01" }, {}]) {
    await assert.rejects(service.invoke({ ...input, operation: "reports.profitAndLoss", input: { tenantId, ...fields } }));
  }
  assert.equal(f.requests.length, count);
});

test("Xero individual contacts and invoices preserve detail and reject foreign records", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const [operation, resource, idName, detail] of [
    ["contacts.get", "Contacts", "ContactID", { Addresses: [{ AddressType: "STREET", City: "Perth" }], ContactPersons: [{ FirstName: "Sam" }], Balances: { AccountsReceivable: { Outstanding: 12.34 } } }],
    ["invoices.get", "Invoices", "InvoiceID", { Type: "ACCREC", CurrencyCode: "AUD", AmountDue: 12.34, LineItems: [{ Description: "Groom", Quantity: 1, UnitAmount: 12.34, AccountCode: "200" }] }]
  ]) {
    const args = { ...input, operation, input: { tenantId, id: recordId.toUpperCase() } };
    f.state.response = { [resource]: [{ [idName]: recordId, ...detail }] };
    assert.deepEqual(await f.service.invoke(args), f.state.response);
    assert.equal(f.requests.at(-1).url.pathname, `/api.xro/2.0/${resource}/${recordId}`);
    assert.equal(f.requests.at(-1).url.search, "");
    const count = f.requests.length;
    await assert.rejects(f.service.invoke({ ...args, input: { tenantId, id: "../other" } }));
    assert.equal(f.requests.length, count);
    f.state.response = { [resource]: [{ [idName]: otherTenant, ...detail }] };
    await assert.rejects(f.service.invoke(args), { code: "connector_response_invalid" });
    f.state.response = { [resource]: [] };
    await assert.rejects(f.service.invoke(args), { code: "connector_response_invalid" });
    f.state.response = { [resource]: [{ [idName]: 42 }] };
    await assert.rejects(f.service.invoke(args));
  }
});

test("Xero contact writes use stable idempotency and never forward a write to tenant discovery", async (t) => {
  const f = await fixture(t);
  const scopes = [...defaults, "accounting.contacts"];
  f.options.configuration.integrations.xero.scopes = scopes; f.state.tokenScope = scopes.join(" ");
  const service = createConnectionService(f.options);
  const { authorizationUrl } = await service.beginAuthorization(input);
  const url = new URL(callback); url.searchParams.set("code", "fixture-code"); url.searchParams.set("state", new URL(authorizationUrl).searchParams.get("state"));
  await service.completeAuthorization({ ...input, callbackUrl: url.href });
  f.state.response = { Contacts: [{ ContactID: recordId, Name: "New customer" }] };
  for (const update of [false, true]) {
    const args = { ...input, operation: update ? "contacts.update" : "contacts.create", input: { tenantId, idempotencyKey: "contact-request-1", Name: "New customer", ...(update ? { id: recordId } : {}) } };
    assert.deepEqual(await service.invoke(args), f.state.response);
    const [lookup, write] = f.requests.slice(-2);
    assert.equal(lookup.url.pathname, "/connections"); assert.equal(lookup.init.method, "GET");
    assert.equal(lookup.init.body, undefined); assert.equal(lookup.headers.has("idempotency-key"), false);
    assert.equal(write.init.method, update ? "POST" : "PUT");
    assert.equal(write.headers.get("idempotency-key"), "contact-request-1");
    assert.deepEqual(JSON.parse(write.init.body), { Contacts: [{ Name: "New customer" }] });
    f.state.response.Contacts[0].HasValidationErrors = true;
    await assert.rejects(service.invoke(args), { code: "connector_response_invalid" });
    delete f.state.response.Contacts[0].HasValidationErrors;
  }
  const before = f.requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "contacts.create", input: { tenantId, Name: "No request key" } }));
  await assert.rejects(service.invoke({ ...input, operation: "contacts.update", input: { tenantId, id: recordId, idempotencyKey: "empty-change" } }));
  assert.equal(f.requests.length, before);
});

test("Xero records one deliberate invoice payment with an explicit account and no automatic retry", async (t) => {
  const f = await fixture(t);
  const scopes = [...defaults, "accounting.payments"];
  f.options.configuration.integrations.xero.scopes = scopes; f.state.tokenScope = scopes.join(" ");
  const service = createConnectionService(f.options);
  const { authorizationUrl } = await service.beginAuthorization(input);
  const url = new URL(callback); url.searchParams.set("code", "fixture-code"); url.searchParams.set("state", new URL(authorizationUrl).searchParams.get("state"));
  await service.completeAuthorization({ ...input, callbackUrl: url.href });
  f.state.response = { Accounts: [{ AccountID: recordId, Type: "BANK", CurrencyCode: "AUD", EnablePaymentsToAccount: true }] };
  assert.deepEqual(await service.invoke({ ...input, operation: "accounts.list", input: { tenantId } }), f.state.response);
  assert.equal(f.requests.at(-1).url.search, "");
  const values = { tenantId, idempotencyKey: "invoice-payment-1", invoiceId: recordId, accountId: otherTenant, Date: "2026-09-13", Amount: 12.34, CurrencyRate: 1.2345, Reference: "Receipt 123" };
  const args = { ...input, operation: "payments.create", input: values };
  f.state.response = { Payments: [{ PaymentID: recordId, Amount: 12.34, Status: "AUTHORISED" }] };
  assert.deepEqual(await service.invoke(args), f.state.response);
  const [lookup, write] = f.requests.slice(-2);
  assert.equal(lookup.init.method, "GET"); assert.equal(lookup.init.body, undefined);
  assert.equal(lookup.headers.has("idempotency-key"), false);
  assert.equal(write.init.method, "PUT"); assert.equal(write.headers.get("idempotency-key"), values.idempotencyKey);
  assert.deepEqual(JSON.parse(write.init.body), { Payments: [{ Date: values.Date, Amount: 12.34, CurrencyRate: 1.2345, Reference: values.Reference, Invoice: { InvoiceID: recordId }, Account: { AccountID: otherTenant } }] });
  const count = f.requests.length;
  for (const patch of [{ Amount: 0 }, { Amount: -1 }, { Amount: Infinity }, { Date: "2026-02-30" }, { accountId: "bad" }, { IsReconciled: true }]) {
    await assert.rejects(service.invoke({ ...args, input: { ...values, ...patch } }));
  }
  assert.equal(f.requests.length, count);
  f.state.response.Payments[0].ValidationErrors = [{ Message: "Amount exceeds balance" }];
  await assert.rejects(service.invoke(args), { code: "connector_response_invalid" });
  f.state.response = { Payments: [{ PaymentID: recordId, Amount: 12.34 }] };
  f.state.accountingStatus = 500; const before = f.requests.length;
  await assert.rejects(service.invoke(args), { code: "connector_provider_failed" });
  assert.equal(f.requests.length, before + 2);
});

test("Xero invoice writes retain explicit currency, tax basis and line precision with reviewed status transitions", async (t) => {
  const f = await fixture(t);
  const scopes = [...defaults, "accounting.invoices"];
  f.options.configuration.integrations.xero.scopes = scopes; f.state.tokenScope = scopes.join(" ");
  const service = createConnectionService(f.options);
  const { authorizationUrl } = await service.beginAuthorization(input);
  const url = new URL(callback); url.searchParams.set("code", "fixture-code"); url.searchParams.set("state", new URL(authorizationUrl).searchParams.get("state"));
  await service.completeAuthorization({ ...input, callbackUrl: url.href });
  const fields = { Type: "ACCREC", contactId: otherTenant, Date: "2026-09-13", DueDate: "2026-09-30", CurrencyCode: "AUD", LineAmountTypes: "Exclusive",
    LineItems: [{ Description: "Grooming", Quantity: 2, UnitAmount: 12.3456, AccountCode: "200", TaxType: "OUTPUT", DiscountRate: 10 }] };
  const args = { ...input, operation: "invoices.create", input: { tenantId, idempotencyKey: "invoice-1", ...fields } };
  f.state.response = { Invoices: [{ InvoiceID: recordId, Status: "DRAFT", CurrencyCode: "AUD", LineItems: fields.LineItems }] };
  assert.deepEqual(await service.invoke(args), f.state.response);
  const write = f.requests.at(-1);
  assert.equal(write.init.method, "PUT"); assert.equal(write.url.search, "?unitdp=4");
  const { contactId, ...expected } = fields;
  assert.deepEqual(JSON.parse(write.init.body), { Invoices: [{ ...expected, Status: "DRAFT", Contact: { ContactID: contactId } }] });
  const update = { ...input, operation: "invoices.update", input: { tenantId, idempotencyKey: "invoice-authorise-1", id: recordId, Status: "AUTHORISED" } };
  f.state.response.Invoices[0].Status = "AUTHORISED";
  assert.deepEqual(await service.invoke(update), f.state.response);
  assert.equal(f.requests.at(-1).init.method, "POST");
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { Invoices: [{ Status: "AUTHORISED" }] });
  const count = f.requests.length;
  for (const patch of [{ Status: "PAID" }, { CurrencyCode: "dollars" }, { LineItems: [] }, { Type: "ACCPAY" }, { Date: "2026-02-30" }]) {
    await assert.rejects(service.invoke({ ...args, input: { ...args.input, ...patch } }));
  }
  assert.equal(f.requests.length, count);
  f.state.response.Invoices[0].ValidationErrors = [{ Message: "Invalid account code" }];
  await assert.rejects(service.invoke(args), { code: "connector_response_invalid" });
  f.state.accountingStatus = 500; const before = f.requests.length;
  await assert.rejects(service.invoke(args), { code: "connector_provider_failed" });
  assert.equal(f.requests.length, before + 2);
});

test("Xero settings discovery preserves native tax and tracking data without summary filtering", async t => {
  const f = await fixture(t); await f.connect();
  for (const [operation, resource, fields, row] of [
    ["currencies.list", "Currencies", {}, { Code: "AUD", Description: "Australian Dollar" }],
    ["taxRates.list", "TaxRates", {}, { TaxType: "OUTPUT", Name: "GST", EffectiveRate: 10, TaxComponents: [{ Name: "GST", Rate: 10 }] }],
    ["trackingCategories.list", "TrackingCategories", { includeArchived: true }, { TrackingCategoryID: recordId, Name: "Location", Options: [{ TrackingOptionID: otherTenant, Name: "Perth" }] }]
  ]) {
    const args = { ...input, operation, input: { tenantId, ...fields } };
    f.state.response = { [resource]: [row] };
    assert.deepEqual(await f.service.invoke(args), f.state.response);
    assert.equal(f.requests.at(-1).url.pathname, `/api.xro/2.0/${resource}`);
    assert.deepEqual(Object.fromEntries(f.requests.at(-1).url.searchParams), Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])));
    f.state.response = { [resource]: [{}] };
    await assert.rejects(f.service.invoke(args), { code: "connector_response_invalid" });
    f.state.response = { [resource]: [] };
    assert.deepEqual(await f.service.invoke(args), f.state.response);
  }
});

test("Xero aged, executive, bank and trial reports use individual scopes and explicit reporting dates", async t => {
  const f = await fixture(t);
  const cases = [
    ["reports.agedReceivables", "AgedReceivablesByContact", "aged", { contactId: recordId, date: "2026-08-31" }],
    ["reports.agedPayables", "AgedPayablesByContact", "aged", { contactId: recordId, date: "2026-08-31", fromDate: "2026-01-01", toDate: "2026-08-31" }],
    ["reports.executiveSummary", "ExecutiveSummary", "executivesummary", { date: "2026-08-31" }],
    ["reports.bankSummary", "BankSummary", "banksummary", { fromDate: "2026-08-01", toDate: "2026-08-31" }],
    ["reports.trialBalance", "TrialBalance", "trialbalance", { date: "2026-08-31", paymentsOnly: true }]
  ];
  const scopes = [...defaults, ...new Set(cases.map(([, , scope]) => `accounting.reports.${scope}.read`))];
  f.options.configuration.integrations.xero.scopes = scopes; f.state.tokenScope = scopes.join(" ");
  const service = createConnectionService(f.options);
  const { authorizationUrl } = await service.beginAuthorization(input);
  const url = new URL(callback); url.searchParams.set("code", "fixture-code");
  url.searchParams.set("state", new URL(authorizationUrl).searchParams.get("state"));
  await service.completeAuthorization({ ...input, callbackUrl: url.href });
  for (const [operation, resource, , fields] of cases) {
    f.state.response = { Reports: [{ ReportID: resource, Rows: [{ RowType: "Row", Cells: [{ Value: "123.45" }] }] }] };
    const args = { ...input, operation, input: { tenantId, ...fields } };
    assert.deepEqual(await service.invoke(args), f.state.response);
    assert.equal(f.requests.at(-1).url.pathname, `/api.xro/2.0/Reports/${resource}`);
    assert.deepEqual(Object.fromEntries(f.requests.at(-1).url.searchParams), Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v)])));
    const count = f.requests.length;
    await assert.rejects(service.invoke({ ...args, input: { ...args.input, date: "2026-02-30" } }));
    assert.equal(f.requests.length, count);
  }
  const limited = await fixture(t); await limited.connect();
  const count = limited.requests.length;
  await assert.rejects(limited.service.invoke({ ...input, operation: "reports.trialBalance", input: { tenantId, date: "2026-08-31" } }));
  assert.equal(limited.requests.length, count);
});

test("Xero budgets preserve account balances and enforce date ranges, record identity and report periods", async t => {
  const f = await fixture(t);
  const scopes = [...defaults, "accounting.budgets.read", "accounting.reports.budgetsummary.read"];
  f.options.configuration.integrations.xero.scopes = scopes; f.state.tokenScope = scopes.join(" ");
  const service = createConnectionService(f.options);
  const { authorizationUrl } = await service.beginAuthorization(input);
  const url = new URL(callback); url.searchParams.set("code", "fixture-code");
  url.searchParams.set("state", new URL(authorizationUrl).searchParams.get("state"));
  await service.completeAuthorization({ ...input, callbackUrl: url.href });
  const budget = { BudgetID: recordId, Type: "OVERALL", BudgetLines: [{ AccountID: otherTenant, AccountCode: "200",
    BudgetBalances: [{ Period: "2026-08", Amount: 123.45, Notes: "Grooming" }] }] };
  for (const operation of ["budgets.list", "budgets.get"]) {
    f.state.response = { Budgets: [budget] };
    const fields = { tenantId, DateFrom: "2026-01-01", DateTo: "2026-12-31", ...(operation === "budgets.get" ? { id: recordId.toUpperCase() } : {}) };
    const args = { ...input, operation, input: fields };
    assert.deepEqual(await service.invoke(args), f.state.response);
    assert.equal(f.requests.at(-1).url.pathname, `/api.xro/2.0/Budgets${operation === "budgets.get" ? `/${recordId}` : ""}`);
    assert.equal(f.requests.at(-1).url.search, "?DateFrom=2026-01-01&DateTo=2026-12-31");
    const count = f.requests.length;
    await assert.rejects(service.invoke({ ...args, input: { ...fields, DateTo: "2025-12-31" } }));
    assert.equal(f.requests.length, count);
    if (operation === "budgets.get") {
      f.state.response = { Budgets: [{ ...budget, BudgetID: otherTenant }] };
      await assert.rejects(service.invoke(args), { code: "connector_response_invalid" });
    } else {
      f.state.response = { Budgets: [] };
      assert.deepEqual(await service.invoke(args), f.state.response);
    }
  }
  const args = { ...input, operation: "reports.budgetSummary", input: { tenantId, date: "2026-08-31", periods: 4, timeframe: 3 } };
  f.state.response = { Reports: [{ ReportID: "BudgetSummary", Rows: [{ RowType: "Row", Cells: [{ Value: "123.45" }] }] }] };
  assert.deepEqual(await service.invoke(args), f.state.response);
  assert.equal(f.requests.at(-1).url.search, "?date=2026-08-31&periods=4&timeframe=3");
  const count = f.requests.length;
  for (const fields of [{ timeframe: "QUARTER" }, { timeframe: 2 }, { periods: 13 }, { date: "2026-02-30" }]) {
    await assert.rejects(service.invoke({ ...args, input: { ...args.input, ...fields } }));
  }
  assert.equal(f.requests.length, count);
});

test("Xero bank and manual journal reads preserve native detail and enforce fixed page and record boundaries", async t => {
  const f = await fixture(t);
  const scopes = [...defaults, "accounting.banktransactions.read", "accounting.manualjournals.read"];
  f.options.configuration.integrations.xero.scopes = scopes; f.state.tokenScope = scopes.join(" ");
  const service = createConnectionService(f.options);
  const { authorizationUrl } = await service.beginAuthorization(input);
  const url = new URL(callback); url.searchParams.set("code", "fixture-code");
  url.searchParams.set("state", new URL(authorizationUrl).searchParams.get("state"));
  await service.completeAuthorization({ ...input, callbackUrl: url.href });
  for (const [prefix, resource, idName, detail] of [
    ["bankTransactions", "BankTransactions", "BankTransactionID", { Type: "SPEND", CurrencyCode: "AUD", Total: 12.34, LineItems: [{ AccountCode: "400", UnitAmount: 12.34 }], BankAccount: { AccountID: otherTenant } }],
    ["manualJournals", "ManualJournals", "ManualJournalID", { Narration: "Adjustment", Status: "DRAFT", JournalLines: [{ AccountCode: "400", LineAmount: 12.34 }, { AccountCode: "200", LineAmount: -12.34 }] }]
  ]) {
    const row = { [idName]: recordId, ...detail };
    const list = { ...input, operation: `${prefix}.list`, input: { tenantId, page: 2 } };
    f.state.response = { [resource]: [row] };
    assert.deepEqual(await service.invoke(list), f.state.response);
    assert.equal(f.requests.at(-1).url.pathname, `/api.xro/2.0/${resource}`);
    assert.equal(f.requests.at(-1).url.search, "?page=2");
    const count = f.requests.length;
    await assert.rejects(service.invoke({ ...list, input: { tenantId, pageSize: 200 } }));
    assert.equal(f.requests.length, count);
    f.state.response = { [resource]: Array(101).fill(row) };
    await assert.rejects(service.invoke(list), { code: "connector_response_invalid" });
    const get = { ...input, operation: `${prefix}.get`, input: { tenantId, id: recordId } };
    f.state.response = { [resource]: [row] };
    assert.deepEqual(await service.invoke(get), f.state.response);
    assert.equal(f.requests.at(-1).url.pathname, `/api.xro/2.0/${resource}/${recordId}`);
    assert.equal(f.requests.at(-1).url.search, "");
    f.state.response = { [resource]: [{ ...row, [idName]: otherTenant }] };
    await assert.rejects(service.invoke(get), { code: "connector_response_invalid" });
    f.state.response = { [resource]: [] };
    assert.deepEqual(await service.invoke(list), f.state.response);
  }
});

test("Xero manual journal writes default to draft and retain deliberate posting, signed lines and idempotency", async t => {
  const f = await fixture(t);
  const scopes = [...defaults, "accounting.manualjournals"];
  f.options.configuration.integrations.xero.scopes = scopes; f.state.tokenScope = scopes.join(" ");
  const service = createConnectionService(f.options);
  const { authorizationUrl } = await service.beginAuthorization(input);
  const url = new URL(callback); url.searchParams.set("code", "fixture-code");
  url.searchParams.set("state", new URL(authorizationUrl).searchParams.get("state"));
  await service.completeAuthorization({ ...input, callbackUrl: url.href });
  const fields = { tenantId, idempotencyKey: "journal-1", Narration: "Reclassification", Date: "2026-08-31", LineAmountTypes: "NoTax",
    JournalLines: [{ AccountCode: "400", LineAmount: 12.34, Tracking: [{ Name: "Location", Option: "Perth" }] }, { AccountCode: "200", LineAmount: -12.34 }] };
  const args = { ...input, operation: "manualJournals.create", input: fields };
  f.state.response = { ManualJournals: [{ ManualJournalID: recordId, Status: "DRAFT" }] };
  assert.deepEqual(await service.invoke(args), f.state.response);
  assert.equal(f.requests.at(-1).init.method, "PUT");
  assert.equal(f.requests.at(-1).headers.get("idempotency-key"), "journal-1");
  const { tenantId: unusedTenant, idempotencyKey: unusedKey, ...journal } = fields;
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { ManualJournals: [{ ...journal, Status: "DRAFT" }] });
  assert.equal(f.requests.at(-2).init.method, "GET");
  assert.equal(f.requests.at(-2).init.body, undefined);
  const update = { ...input, operation: "manualJournals.update", input: { tenantId, idempotencyKey: "journal-post-1", id: recordId, Status: "POSTED" } };
  await service.invoke(update);
  assert.equal(f.requests.at(-1).url.pathname, `/api.xro/2.0/ManualJournals/${recordId}`);
  assert.equal(f.requests.at(-1).init.method, "POST");
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { ManualJournals: [{ Status: "POSTED", ManualJournalID: recordId }] });
  const count = f.requests.length;
  for (const patch of [{ Status: "AUTHORISED" }, { JournalLines: [] }, { Date: "2026-02-30" }, { JournalLines: [{ AccountCode: "400", LineAmount: Infinity }, fields.JournalLines[1]] }]) {
    await assert.rejects(service.invoke({ ...args, input: { ...fields, ...patch } }));
  }
  assert.equal(f.requests.length, count);
  f.state.response = { ManualJournals: [{ ManualJournalID: recordId, ValidationErrors: [{ Message: "Journal is not balanced" }] }] };
  await assert.rejects(service.invoke(args), { code: "connector_response_invalid" });
  f.state.accountingStatus = 500;
  const beforeFailure = f.requests.length;
  await assert.rejects(service.invoke(args));
  assert.equal(f.requests.length, beforeFailure + 2);
});

test("Xero spend and receive writes use explicit bank/contact references and never reconcile or retry automatically", async t => {
  const f = await fixture(t);
  const scopes = [...defaults, "accounting.banktransactions"];
  f.options.configuration.integrations.xero.scopes = scopes; f.state.tokenScope = scopes.join(" ");
  const service = createConnectionService(f.options);
  const { authorizationUrl } = await service.beginAuthorization(input);
  const url = new URL(callback); url.searchParams.set("code", "fixture-code");
  url.searchParams.set("state", new URL(authorizationUrl).searchParams.get("state"));
  await service.completeAuthorization({ ...input, callbackUrl: url.href });
  const fields = { tenantId, idempotencyKey: "spend-1", Type: "SPEND", contactId: recordId, bankAccountId: otherTenant,
    Date: "2026-08-31", LineAmountTypes: "Exclusive", Reference: "Supplies", CurrencyRate: 1.2345,
    LineItems: [{ Description: "Supplies", Quantity: 2, UnitAmount: 12.3456, AccountCode: "400", TaxType: "INPUT" }] };
  f.state.response = { BankTransactions: [{ BankTransactionID: recordId, Status: "AUTHORISED", CurrencyCode: "AUD" }] };
  const args = { ...input, operation: "bankTransactions.create", input: fields };
  assert.deepEqual(await service.invoke(args), f.state.response);
  assert.equal(f.requests.at(-1).init.method, "PUT");
  assert.equal(f.requests.at(-1).url.search, "?unitdp=4");
  assert.equal(f.requests.at(-1).headers.get("idempotency-key"), "spend-1");
  const { tenantId: unusedTenant, idempotencyKey: unusedKey, contactId, bankAccountId, ...transaction } = fields;
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { BankTransactions: [{ ...transaction, Contact: { ContactID: contactId }, BankAccount: { AccountID: bankAccountId } }] });
  await service.invoke({ ...args, input: { ...fields, Type: "RECEIVE", idempotencyKey: "receive-1" } });
  assert.equal(JSON.parse(f.requests.at(-1).init.body).BankTransactions[0].Type, "RECEIVE");
  const update = { ...input, operation: "bankTransactions.update", input: { tenantId, id: recordId, idempotencyKey: "delete-1", Status: "DELETED" } };
  await service.invoke(update);
  assert.equal(f.requests.at(-1).init.method, "POST");
  assert.equal(f.requests.at(-1).url.pathname, `/api.xro/2.0/BankTransactions/${recordId}`);
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { BankTransactions: [{ Status: "DELETED", BankTransactionID: recordId }] });
  const count = f.requests.length;
  for (const patch of [{ IsReconciled: true }, { Type: "SPEND-TRANSFER" }, { CurrencyCode: "USD" }, { LineItems: [] }, { bankAccountId: "bad" }]) {
    await assert.rejects(service.invoke({ ...args, input: { ...fields, ...patch } }));
  }
  assert.equal(f.requests.length, count);
  f.state.response = { BankTransactions: [{ BankTransactionID: recordId, ValidationErrors: [{ Message: "Bank account invalid" }] }] };
  await assert.rejects(service.invoke(args), { code: "connector_response_invalid" });
  f.state.accountingStatus = 500;
  const before = f.requests.length;
  await assert.rejects(service.invoke(args)); assert.equal(f.requests.length, before + 2);
});

test("Xero attachments use parent-bound file paths, binary bodies and checked organisation access", async t => {
  const f = await fixture(t);
  const scopes = [...defaults, "accounting.attachments"];
  f.options.configuration.integrations.xero.scopes = scopes; f.state.tokenScope = scopes.join(" ");
  const service = createConnectionService(f.options);
  const { authorizationUrl } = await service.beginAuthorization(input);
  const url = new URL(callback); url.searchParams.set("code", "fixture-code");
  url.searchParams.set("state", new URL(authorizationUrl).searchParams.get("state"));
  await service.completeAuthorization({ ...input, callbackUrl: url.href });
  const file = { AttachmentID: otherTenant, FileName: "receipt #1.pdf", ContentLength: 5 };
  for (const resource of ["Contacts", "Invoices", "BankTransactions", "ManualJournals"]) {
    const fields = { tenantId, resource, id: recordId };
    f.state.response = { Attachments: [file] };
    assert.deepEqual(await service.invoke({ ...input, operation: "attachments.list", input: fields }), f.state.response);
    assert.equal(f.requests.at(-1).url.pathname, `/api.xro/2.0/${resource}/${recordId}/Attachments`);
    for (const [operation, method] of [["attachments.upload", "PUT"], ["attachments.replace", "POST"]]) {
      const args = { ...input, operation, input: { ...fields, idempotencyKey: "file-1", filename: file.FileName, contentBase64: "aGVsbG8=" } };
      assert.deepEqual(await service.invoke(args), f.state.response);
      const sent = f.requests.at(-1);
      assert.equal(sent.init.method, method);
      assert.equal(sent.url.pathname, `/api.xro/2.0/${resource}/${recordId}/Attachments/receipt%20%231.pdf`);
      assert.deepEqual(sent.init.body, Buffer.from("hello"));
      assert.equal(sent.headers.get("content-type"), "application/octet-stream");
      assert.equal(sent.init.credentials, "omit");
      assert.equal(f.requests.at(-2).init.body, undefined);
      assert.equal(f.requests.at(-2).headers.has("idempotency-key"), false);
      const count = f.requests.length;
      for (const patch of [{ filename: "../secret" }, { filename: ".." }, { contentBase64: "not base64" }, { resource: "Unknown" }]) {
        await assert.rejects(service.invoke({ ...args, input: { ...args.input, ...patch } }));
      }
      assert.equal(f.requests.length, count);
    }
    f.state.binaryResponse = Buffer.from("hello");
    const download = { ...input, operation: "attachments.download", input: { ...fields, attachmentId: otherTenant } };
    assert.deepEqual(await service.invoke(download), { contentBase64: "aGVsbG8=", size: 5, contentType: "application/pdf" });
    assert.equal(f.requests.at(-1).url.pathname, `/api.xro/2.0/${resource}/${recordId}/Attachments/${otherTenant}`);
    delete f.state.binaryResponse;
  }
  const download = { ...input, operation: "attachments.download", input: { tenantId, resource: "Invoices", id: recordId, attachmentId: otherTenant } };
  f.state.binaryResponse = Buffer.alloc(3 * 1024 * 1024 + 1);
  await assert.rejects(service.invoke(download), { code: "connector_response_too_large" });
  f.state.binaryResponse = Buffer.alloc(0);
  await assert.rejects(service.invoke(download), { code: "connector_response_invalid" });
  f.state.accountingStatus = 401;
  await assert.rejects(service.invoke(download));
  assert.equal((await service.status(input)).status, "reconnect-required");
});
