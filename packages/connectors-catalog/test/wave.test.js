import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { waveProvider } from "../src/server/wave.js";

const context = { applicationId: "app-one", subjectId: "person-one" };
const input = { context, integrationId: "wave" };
const scopes = ["user:read", "business:read", "customer:read", "invoice:read"];
const callback = "https://app.example.test/connections/wave/callback";
const user = { data: { user: { id: "VXNlcjpmaXh0dXJl", firstName: "Fixture", lastName: "User", defaultEmail: "fixture@example.test" } } };
const businessId = "QnVzaW5lc3M6Zml4dHVyZQ==";
const page = (nodes = [], currentPage = 1, totalPages = 1, totalCount = nodes.length) => ({
  pageInfo: { currentPage, totalPages, totalCount }, edges: nodes.map((node) => ({ node }))
});
const business = { id: businessId, name: "Fixture business", isPersonal: false };
const customer = { id: "Q3VzdG9tZXI6b25l", name: "Customer", email: null };
const invoice = { id: "SW52b2ljZTpvbmU=", invoiceNumber: "001", invoiceDate: "2026-09-09", status: "DRAFT", currency: { code: "USD" } };

async function fixture(t, requestedScopes = scopes) {
  const directory = await mkdtemp(path.join(tmpdir(), "wave-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" });
  const requests = [];
  const state = { time: Date.now(), tokenCount: 0, tokenStatus: 200, tokenResponse: null, tokenScopes: requestedScopes.join(" "), status: 200, response: null, hang: false };
  const bindings = { "env:WAVE_SECRET": "fixture-wave-secret", "env:WAVE_CALLBACK": callback };
  const options = {
    configuration: { schemaVersion: 1, integrations: { wave: { provider: "wave", accountMode: "per-user", scopes: requestedScopes,
      authentication: { method: "oauth2", registrationRef: "wave" } } }, registrations: { wave: { source: "own", clientId: "fixture-wave-client",
      clientSecretRef: "env:WAVE_SECRET", callbackUrlRef: "env:WAVE_CALLBACK", tokenEndpointAuthMethod: "client_secret_post" } } },
    providers: [{ ...waveProvider, requestTimeoutMs: 50 }], authorize: async (owner) => owner,
    resolveReference: async (ref) => bindings[ref], now: () => state.time,
    store: createFileConnectionStore({ directory, protection }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address));
      requests.push({ url, init, headers: new Headers(init.headers) });
      if (url.origin === "https://api.waveapps.com") {
        assert.equal(url.pathname, "/oauth2/token/");
        assert.equal(init.method, "POST");
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), "fixture-wave-client");
        assert.equal(body.get("client_secret"), "fixture-wave-secret");
        assert.equal(body.get("redirect_uri"), callback);
        if (body.get("grant_type") === "refresh_token") assert.equal(body.get("refresh_token"), `fixture-refresh-${state.tokenCount}`);
        if (state.tokenStatus === 200) state.tokenCount += 1;
        return Response.json(state.tokenResponse || { access_token: `fixture-access-${state.tokenCount}`, refresh_token: `fixture-refresh-${state.tokenCount}`,
          token_type: "Bearer", expires_in: 60, scope: state.tokenScopes, userId: user.data.user.id, businessId }, { status: state.tokenStatus });
      }
      assert.equal(url.href, "https://gql.waveapps.com/graphql/public");
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer fixture-access-${state.tokenCount}`);
      if (state.hang) return new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Abort was not delivered")), 1000);
        const abort = () => { clearTimeout(timer); reject(init.signal.reason); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
      });
      const body = JSON.parse(init.body);
      let value = user;
      if (body.query.includes("ConnectorWaveBusinesses")) value = { data: { businesses: page([business], body.variables.page) } };
      if (body.query.includes("ConnectorWaveCustomers")) value = { data: { business: { id: businessId, customers: page([customer], body.variables.page) } } };
      if (body.query.includes("ConnectorWaveInvoices")) value = { data: { business: { id: businessId, invoices: page([invoice], body.variables.page) } } };
      return Response.json(state.responses?.shift() || state.response || value, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  async function start() {
    const result = await service.beginAuthorization(input);
    const url = new URL(result.authorizationUrl);
    const redirect = new URL(callback);
    redirect.searchParams.set("code", "fixture-wave-code");
    redirect.searchParams.set("state", url.searchParams.get("state"));
    return { url, callbackUrl: redirect.href };
  }
  const connect = async () => service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  return { service, options, state, requests, directory, bindings, start, connect };
}

test("Wave code consent verifies the user and persists encrypted state for CLI restart", async (t) => {
  const { service, options, requests, directory, start } = await fixture(t);
  const started = await start();
  assert.equal(started.url.origin + started.url.pathname, "https://api.waveapps.com/oauth2/authorize/");
  assert.equal(started.url.searchParams.get("scope"), scopes.join(" "));
  assert.equal(started.url.searchParams.get("redirect_uri"), callback);
  assert.equal(started.url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(started.url.searchParams.has("client_secret"), false);
  const connected = await service.completeAuthorization({ ...input, callbackUrl: started.callbackUrl });
  assert.equal(connected.status, "connected");
  assert.deepEqual(connected.grantedScopes, scopes);
  const exchange = new URLSearchParams(requests[0].init.body);
  assert.equal(exchange.get("grant_type"), "authorization_code");
  assert.equal(exchange.get("code"), "fixture-wave-code");
  assert.ok(exchange.get("code_verifier"));
  assert.match(JSON.parse(requests[1].init.body).query, /query ConnectorWaveUser/);
  for (const file of await readdir(directory)) {
    const text = await readFile(path.join(directory, file), "utf8");
    for (const secret of ["fixture-wave-secret", "fixture-wave-code", "fixture-access-1", "fixture-refresh-1"]) assert.equal(text.includes(secret), false);
  }
  const restarted = createConnectionService(options);
  assert.deepEqual(await restarted.status(input), { ...connected, callbackUrl: callback });
  assert.deepEqual(await restarted.invoke({ ...input, operation: "user.read" }), user);
});

test("Wave reads bounded business, customer and invoice pages without following returned URLs", async (t) => {
  const { service, state, requests, connect } = await fixture(t);
  await connect();
  const businesses = await service.invoke({ ...input, operation: "businesses.list" });
  assert.deepEqual(businesses.data.businesses.edges, [{ node: business }]);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { page: 1, pageSize: 20 });
  for (const [operation, resource, node] of [["customers.list", "customers", customer], ["invoices.list", "invoices", invoice]]) {
    const result = await service.invoke({ ...input, operation, input: { businessId, page: 2, pageSize: 5 } });
    assert.deepEqual(result.data.business[resource].edges, [{ node }]);
    const body = JSON.parse(requests.at(-1).init.body);
    assert.deepEqual(body.variables, { businessId, page: 2, pageSize: 5 });
    assert.equal(body.query.includes(businessId), false);
    state.response = { data: { business: { id: businessId, [resource]: page([], 3, 3, 6) } } };
    assert.deepEqual(await service.invoke({ ...input, operation, input: { businessId, page: 3 } }), state.response);
    state.response = null;
  }
  state.response = { data: { businesses: page([null], 1, 2, 2) } };
  assert.deepEqual(await service.invoke({ ...input, operation: "businesses.list" }), state.response);
  state.response = { data: { businesses: page([], 1, 0, 0) } };
  assert.deepEqual(await service.invoke({ ...input, operation: "businesses.list" }), state.response);
});

test("Wave validates all operation inputs before HTTP and rejects arbitrary queries or destinations", async (t) => {
  const { service, requests, connect } = await fixture(t);
  await connect();
  const count = requests.length;
  for (const values of [{}, { businessId: "" }, { businessId: " " }, { businessId: "bad\nvalue" }, { businessId: "x".repeat(2049) },
    { businessId, page: 0 }, { businessId, page: 2.5 }, { businessId, page: 2_147_483_648 }, { businessId, pageSize: 101 },
    { businessId, pageSize: 0 }, { businessId, url: "https://invalid.test" }, { businessId, query: "mutation { anything }" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "customers.list", input: values }), { code: "connector_input_invalid" });
  }
  await assert.rejects(service.invoke({ ...input, operation: "user.read", input: { id: "other" } }), { code: "connector_input_invalid" });
  await assert.rejects(service.invoke({ ...input, operation: "arbitrary.query" }), { code: "connector_operation_unknown" });
  assert.equal(requests.length, count);
});

test("Wave enforces granted read scopes, preserves wildcard grants and never treats write as read", async (t) => {
  const reduced = await fixture(t);
  reduced.state.tokenScopes = "user:read business:read";
  await reduced.connect();
  const count = reduced.requests.length;
  await assert.rejects(reduced.service.invoke({ ...input, operation: "customers.list", input: { businessId } }), { code: "connector_scope_missing" });
  assert.equal(reduced.requests.length, count);
  const writes = await fixture(t, ["user:read", "customer:write"]);
  await writes.connect();
  await assert.rejects(writes.service.invoke({ ...input, operation: "customers.list", input: { businessId } }), { code: "connector_scope_missing" });
  assert.equal(writes.requests.length, 2);
  const wildcard = await fixture(t, ["user:*", "business:*", "customer:*", "invoice:*"]);
  await wildcard.connect();
  for (const operation of ["businesses.list", "customers.list", "invoices.list"]) {
    await wildcard.service.invoke({ ...input, operation, input: operation === "businesses.list" ? {} : { businessId } });
  }
  assert.deepEqual((await wildcard.service.status(input)).grantedScopes, ["user:*", "business:*", "customer:*", "invoice:*"]);
});

test("Wave serializes refresh with the original callback and preserves rotated grants after API failure", async (t) => {
  const { service, options, state, requests, connect } = await fixture(t);
  await connect(); state.time += 40_000;
  await Promise.all([service.invoke({ ...input, operation: "user.read" }), service.invoke({ ...input, operation: "user.read" })]);
  assert.equal(state.tokenCount, 2);
  const refresh = new URLSearchParams(requests.find((r) => String(r.init.body).includes("grant_type=refresh_token")).init.body);
  assert.equal(refresh.get("redirect_uri"), callback);
  state.time += 40_000; state.status = 429;
  state.tokenScopes = "user:read business:read";
  await assert.rejects(service.invoke({ ...input, operation: "user.read" }), { code: "connector_rate_limited" });
  assert.equal(state.tokenCount, 3);
  state.status = 200;
  const restarted = createConnectionService(options);
  await restarted.invoke({ ...input, operation: "user.read" });
  assert.equal(state.tokenCount, 3);
  assert.deepEqual((await restarted.status(input)).grantedScopes, ["user:read", "business:read"]);
  await assert.rejects(restarted.invoke({ ...input, operation: "invoices.list", input: { businessId } }), { code: "connector_scope_missing" });
});

test("Wave rejects cross-owner access, changed callbacks and denied host policy without provider calls", async (t) => {
  const { service, options, bindings, requests, connect } = await fixture(t);
  await connect(); const count = requests.length;
  for (const owner of [{ ...context, applicationId: "other" }, { ...context, subjectId: "other" }]) {
    await assert.rejects(service.invoke({ ...input, context: owner, operation: "user.read" }), { code: "connector_reconnect_required" });
  }
  bindings["env:WAVE_CALLBACK"] = "https://new.example.test/callback";
  assert.equal((await service.status(input)).status, "reconnect-required");
  await assert.rejects(createConnectionService(options).invoke({ ...input, operation: "user.read" }), { code: "connector_reconnect_required" });
  delete bindings["env:WAVE_CALLBACK"];
  assert.equal((await service.status(input)).status, "reconnect-required");
  bindings["env:WAVE_CALLBACK"] = callback;
  assert.equal((await service.status(input)).status, "connected");
  const denied = createConnectionService({ ...options, authorize: async () => null });
  await assert.rejects(denied.invoke({ ...input, operation: "customers.list", input: { businessId } }), { code: "connector_access_denied" });
  assert.equal(requests.length, count);
});

test("Wave consent cancellation, denial and replay preserve an existing connection", async (t) => {
  const { service, requests, start, connect } = await fixture(t);
  const original = await connect(); const count = requests.length;
  const pending = await start();
  await service.cancelAuthorization({ ...input, state: pending.url.searchParams.get("state") });
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: pending.callbackUrl }), { code: "connector_attempt_invalid" });
  const denied = await start(); const redirect = new URL(denied.callbackUrl);
  redirect.searchParams.delete("code"); redirect.searchParams.set("error", "access_denied");
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: redirect.href }), { code: "connector_consent_denied" });
  assert.equal(requests.length, count);
  assert.deepEqual(await service.status(input), { ...original, callbackUrl: callback });
  const complete = await start(); await service.completeAuthorization({ ...input, callbackUrl: complete.callbackUrl });
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: complete.callbackUrl }), { code: "connector_attempt_invalid" });
  await service.disconnect(input);
  assert.equal((await service.status(input)).status, "disconnected");
  assert.equal(requests.length, count + 2);
});

test("Wave maps HTTP and GraphQL errors without returning private partial data or provider messages", async (t) => {
  const { service, state, connect } = await fixture(t);
  for (const [status, code] of [[401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status; state.response = { message: "fixture-wave-secret" };
    await assert.rejects(connect(), (error) => { assert.equal(error.code, code); assert.equal(error.message.includes("fixture-wave-secret"), false); return true; });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  state.status = 200; state.response = null; await connect();
  for (const [providerCode, code] of [["NOT_FOUND", "connector_resource_not_found"], ["INTERNAL_SERVER_ERROR", "connector_provider_failed"], ["GRAPHQL_VALIDATION_FAILED", "connector_provider_failed"], ["UNKNOWN", "connector_provider_failed"], ["UNAUTHENTICATED", "connector_reconnect_required"]]) {
    state.response = { ...user, errors: [{ message: "fixture-wave-secret", extensions: { code: providerCode } }] };
    await assert.rejects(service.invoke({ ...input, operation: "user.read" }), (error) => {
      assert.equal(error.code, code); assert.equal(error.message.includes("fixture-wave-secret"), false); assert.equal(JSON.stringify(error).includes("fixture-wave-secret"), false); return true;
    });
  }
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Wave rejects malformed success responses, wrong businesses and inconsistent paging", async (t) => {
  const { service, state, connect } = await fixture(t);
  for (const response of [{}, { data: null }, { data: { user: null } }, { data: { user: { id: 1, defaultEmail: "a" } } }, { ...user, errors: {} }]) {
    state.response = response;
    await assert.rejects(connect(), { code: "connector_response_invalid" });
  }
  state.response = null; await connect();
  for (const value of [
    { id: "different", customers: page([customer]) },
    { id: businessId, customers: page([customer], 2) },
    { id: businessId, customers: page([customer, customer]) },
    { id: businessId, customers: page([{ id: customer.id }]) },
    { id: businessId, customers: { edges: [], pageInfo: { currentPage: 1, totalPages: -1, totalCount: 0 } } }
  ]) {
    state.response = { data: { business: value } };
    await assert.rejects(service.invoke({ ...input, operation: "customers.list", input: { businessId, pageSize: 1 } }), { code: "connector_response_invalid" });
  }
});

test("Wave requires explicit token scopes and surfaces expired grants and subscription failures", async (t) => {
  const { service, state, connect } = await fixture(t);
  for (const scope of [undefined, null, [], "", "user:read\ninvoice:read"]) {
    state.tokenResponse = { access_token: "fixture", token_type: "Bearer", expires_in: 60, scope };
    await assert.rejects(connect(), { code: "connector_response_invalid" });
  }
  state.tokenResponse = null; await connect(); state.time += 40_000;
  state.tokenStatus = 403; state.tokenResponse = { message: "fixture-wave-secret" };
  await assert.rejects(service.invoke({ ...input, operation: "user.read" }), { code: "connector_permission_denied" });
  state.tokenStatus = 400; state.tokenResponse = { error: "invalid_grant", error_description: "fixture-wave-secret" };
  await assert.rejects(service.invoke({ ...input, operation: "user.read" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Wave request cancellation and timeout stop the transport without retries", async (t) => {
  const { service, state, requests, connect } = await fixture(t);
  await connect(); state.hang = true;
  const count = requests.length;
  const controller = new AbortController();
  const pending = service.invoke({ ...input, operation: "user.read", signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, { code: "connector_cancelled" });
  await assert.rejects(service.invoke({ ...input, operation: "user.read" }), { code: "connector_provider_timeout" });
  assert.equal(requests.length, count + 2);
});

test("Wave guide is valid portable configuration with all captured and granular permission choices", async () => {
  const guide = await readFile(new URL("../docs/wave.md", import.meta.url), "utf8");
  const json = guide.match(/```json\n([\s\S]*?)\n```/u)[1];
  const config = parseIntegrationConfiguration(json, { providers: [waveProvider] });
  assert.deepEqual(config.integrations.wave.scopes, scopes);
  assert.equal(config.registrations.wave.tokenEndpointAuthMethod, "client_secret_post");
  assert.equal(waveProvider.scopes.length, 32);
  for (const scope of ["user:read", "business:read", "account:*", "customer:*", "estimate:*", "invoice:*", "product:*", "sales_tax:*", "transaction:*", "vendor:*"]) {
    assert.ok(waveProvider.scopes.some((value) => value.value === scope));
  }
});


test("Wave creates a customer in the explicitly selected business without replaying writes", async t => {
  const { service, state, requests, connect } = await fixture(t, [...scopes, "customer:write"]);
  await connect();
  const created = { ...customer, business: { id: businessId } };
  state.response = { data: { customerCreate: { didSucceed: true, inputErrors: [], customer: created } } };
  const details = { businessId, name: "Customer", email: "customer@example.test", internalNotes: "Appointment customer" };
  const result = await service.invoke({ ...input, operation: "customers.create", input: { input: details } });
  assert.deepEqual(result.data.customerCreate.customer, created);
  const wire = JSON.parse(requests.at(-1).init.body);
  assert.match(wire.query, /^mutation ConnectorWaveCustomerCreate/);
  assert.deepEqual(wire.variables, { input: details });
  for (const bad of [{ name: "Missing business" }, { businessId, name: "" }, { ...details, unexpected: true }]) {
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "customers.create", input: { input: bad } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, count);
  }
  state.response = { data: { customerCreate: { didSucceed: false, inputErrors: [{ code: "INVALID", path: ["input", "email"] }], customer: null } } };
  let count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "customers.create", input: { input: details } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count + 1);
  state.response = { data: { customerCreate: { didSucceed: true, inputErrors: [], customer: { ...created, business: { id: "another-business" } } } } };
  await assert.rejects(service.invoke({ ...input, operation: "customers.create", input: { input: details } }), { code: "connector_response_invalid" });
  state.status = 503;
  count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "customers.create", input: { input: details } }));
  assert.equal(requests.length, count + 1);
});

test("Wave customer writes require their own granted scope", async t => {
  const { service, requests, connect } = await fixture(t);
  await connect();
  const count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "customers.create", input: { input: { businessId, name: "Denied" } } }),
    { code: "connector_scope_missing" });
  assert.equal(requests.length, count);
});


test("Wave accounting selectors preserve decimal values and enforce business, page and scope bounds", async t => {
  const { service, state, requests, connect } = await fixture(t, [...scopes, "account:read", "product:read", "sales_tax:read", "vendor:read"]);
  await connect();
  const records = {
    accounts: { id: "account-one", name: "Services", currency: { code: "USD" }, type: { value: "INCOME" }, subtype: { value: "INCOME" }, isArchived: false, balance: "9007199254740993.25" },
    products: { id: "product-one", name: "Grooming", description: null, unitPrice: "75.123456789", isSold: true, isBought: false, incomeAccount: { id: "account-one" }, expenseAccount: null },
    salesTaxes: { id: "tax-one", name: "Sales tax", abbreviation: "GST", rate: "0.1", isCompound: false, isRecoverable: true, isArchived: false },
    vendors: { id: "vendor-one", name: "Supplies", email: null, phone: "+10000000000" }
  };
  for (const [resource, record] of Object.entries(records)) {
    state.response = { data: { business: { id: businessId, [resource]: page([record], 2, 3, 3) } } };
    const result = await service.invoke({ ...input, operation: `${resource}.list`, input: { businessId, page: 2, pageSize: 2 } });
    assert.deepEqual(result.data.business[resource].edges[0].node, record);
    const wire = JSON.parse(requests.at(-1).init.body);
    assert.deepEqual(wire.variables, { businessId, page: 2, pageSize: 2 });
    assert.ok(wire.query.includes(`${resource}(page: $page`));
    if (resource === "products") assert.match(wire.query, /sort: \[NAME_ASC\]/);
    state.response.data.business.id = "another-business";
    await assert.rejects(service.invoke({ ...input, operation: `${resource}.list`, input: { businessId } }), { code: "connector_response_invalid" });
    state.response = { data: { business: { id: businessId, [resource]: page([]) } } };
    assert.deepEqual((await service.invoke({ ...input, operation: `${resource}.list`, input: { businessId } })).data.business[resource].edges, []);
  }
  state.response = { data: { business: { id: businessId, products: page([{ ...records.products, unitPrice: 75.1 }]) } } };
  await assert.rejects(service.invoke({ ...input, operation: "products.list", input: { businessId } }), { code: "connector_response_invalid" });
  state.response = null;
  await service.invoke({ ...input, operation: "invoices.list", input: { businessId } });
  assert.match(JSON.parse(requests.at(-1).init.body).query, /sort: \[CREATED_AT_DESC\]/);
});


test("Wave updates customers only after verifying the selected business, with one deliberate mutation", async t => {
  const { service, state, requests, connect } = await fixture(t, [...scopes, "customer:write"]);
  await connect();
  const owner = { data: { business: { id: businessId, customer: { id: customer.id, business: { id: businessId } } } } };
  const updated = { data: { customerPatch: { didSucceed: true, inputErrors: [], customer: { ...customer, name: "Updated", business: { id: businessId } } } } };
  const values = { businessId, input: { id: customer.id, name: "Updated" } };
  state.responses = [owner, updated];
  assert.deepEqual(await service.invoke({ ...input, operation: "customers.update", input: values }), updated);
  const preflight = JSON.parse(requests.at(-2).init.body);
  assert.match(preflight.query, /^query ConnectorWaveCustomerOwner/);
  assert.deepEqual(preflight.variables, { businessId, id: customer.id });
  const write = JSON.parse(requests.at(-1).init.body);
  assert.match(write.query, /^mutation ConnectorWaveCustomerPatch/);
  assert.deepEqual(write.variables, { input: values.input });
  state.responses = [{ data: { business: { id: businessId, customer: null } } }];
  let count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "customers.update", input: values }), { code: "connector_resource_not_found" });
  assert.equal(requests.length, count + 1);
  count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "customers.update", input: { businessId, input: { id: customer.id } } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  state.responses = [owner, { data: { customerPatch: { didSucceed: false, inputErrors: [{ code: "INVALID", path: ["name"] }], customer: null } } }];
  count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "customers.update", input: values }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count + 2);
});

test("Wave invoice draft, edit, approve, send and read preserve money and enforce deliberate transitions", async t => {
  const { service, state, requests, connect } = await fixture(t, [...scopes, "invoice:write", "invoice:send"]);
  await connect();
  const owner = { data: { business: { id: businessId, customer: { id: customer.id, business: { id: businessId } } } } };
  const record = { ...invoice, business: { id: businessId }, customer: { id: customer.id },
    total: { value: "112.50000001", currency: { code: "USD" } }, amountDue: { value: "112.50000001", currency: { code: "USD" } },
    pdfUrl: "https://example.test/private-invoice.pdf", viewUrl: "https://example.test/invoice" };
  const outcome = (action, status = "DRAFT") => ({ data: { [`invoice${action}`]: { didSucceed: true, inputErrors: [], invoice: { ...record, status } } } });
  const invoiceOwner = (status = "DRAFT", enabled = true) => ({ data: { business: { id: businessId, emailSendEnabled: enabled,
    invoice: { id: invoice.id, status, business: { id: businessId } } } } });
  const details = { customerId: customer.id, invoiceDate: "2026-09-13", items: [{ productId: "product-one", quantity: "1.5", unitPrice: "75.00000001", taxes: [] }] };
  state.responses = [owner, outcome("Create")];
  const created = await service.invoke({ ...input, operation: "invoices.create", input: { businessId, input: details } });
  assert.equal(created.data.invoiceCreate.invoice.total.value, "112.50000001");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { input: { ...details, status: "DRAFT", businessId } });
  assert.match(JSON.parse(requests.at(-1).init.body).query, /^mutation ConnectorWaveInvoiceCreate/);
  state.responses = [invoiceOwner(), outcome("Patch")];
  await service.invoke({ ...input, operation: "invoices.update", input: { businessId, input: { id: invoice.id, memo: "Appointment completed" } } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { input: { id: invoice.id, memo: "Appointment completed" } });
  state.responses = [invoiceOwner(), outcome("Approve", "SAVED")];
  await service.invoke({ ...input, operation: "invoices.approve", input: { businessId, input: { invoiceId: invoice.id } } });
  assert.match(JSON.parse(requests.at(-1).init.body).query, /^mutation ConnectorWaveInvoiceApprove/);
  const send = { invoiceId: invoice.id, to: ["customer@example.test"], attachPDF: true, message: "Your invoice" };
  state.responses = [invoiceOwner("SAVED"), { data: { invoiceSend: { didSucceed: true, inputErrors: [] } } }];
  const sent = await service.invoke({ ...input, operation: "invoices.send", input: { businessId, input: send } });
  assert.equal(sent.data.invoiceSend.didSucceed, true);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { input: send });
  state.responses = [{ data: { business: { id: businessId, invoice: record } } }];
  assert.equal((await service.invoke({ ...input, operation: "invoices.get", input: { businessId, invoiceId: invoice.id } })).data.business.invoice.pdfUrl, record.pdfUrl);
  state.responses = [{ data: { business: { id: businessId, invoice: { ...record, business: { id: "different-business" } } } } }];
  await assert.rejects(service.invoke({ ...input, operation: "invoices.get", input: { businessId, invoiceId: invoice.id } }),
    { code: "connector_response_invalid" });
  for (const preflight of [invoiceOwner("DRAFT"), invoiceOwner("SAVED", false), invoiceOwner(null), invoiceOwner(42), invoiceOwner("")]) {
    state.responses = [preflight]; const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "invoices.send", input: { businessId, input: send } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, count + 1);
  }
  state.responses = [invoiceOwner("SAVED"), { data: { invoiceSend: { didSucceed: false, inputErrors: [{ code: "INVALID", path: ["to"] }] } } }];
  const count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "invoices.send", input: { businessId, input: send } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count + 2);
});

test("Wave invoice validation and ownership failures stop writes before mutation", async t => {
  const { service, state, requests, connect } = await fixture(t, [...scopes, "invoice:write", "invoice:send"]);
  await connect();
  const details = { customerId: customer.id, items: [{ productId: "product-one", unitPrice: "10.25" }] };
  for (const values of [{ ...details, invoiceDate: "2026-02-30" }, { ...details, items: [] },
    { ...details, items: [{ productId: "product-one", unitPrice: 10.25 }] },
    { ...details, items: [{ productId: "product-one", unitPrice: "1.123456789" }] }]) {
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "invoices.create", input: { businessId, input: values } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, count);
  }
  state.responses = [{ data: { business: { id: businessId, customer: null } } }];
  let count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "invoices.create", input: { businessId, input: details } }), { code: "connector_resource_not_found" });
  assert.equal(requests.length, count + 1);
  state.responses = [{ data: { business: { id: businessId, invoice: { id: invoice.id, business: { id: "different-business" } }, emailSendEnabled: true } } }];
  count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "invoices.approve", input: { businessId, input: { invoiceId: invoice.id } } }), { code: "connector_resource_not_found" });
  assert.equal(requests.length, count + 1);
  count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "invoices.update", input: { businessId, input: { id: invoice.id } } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
});

test("Wave estimates create, update, approve, send and read use their distinct schema", async t => {
  const { service, state, requests, connect } = await fixture(t, [...scopes, "estimate:*"]);
  await connect();
  const record = { id: "estimate-one", estimateNumber: "E-1", estimateDate: "2026-09-13", dueDate: "2026-10-13", title: "Estimate",
    status: "DRAFT", exchangeRate: "1", currency: { code: "USD" }, customer: { id: customer.id, business: { id: businessId } },
    total: { value: "10.25000001", currency: { code: "USD" } }, amountDue: { value: "10.25000001", currency: { code: "USD" } }, pdfUrl: null, viewUrl: null };
  const owner = { data: { business: { id: businessId, customer: record.customer } } };
  const existing = status => ({ data: { business: { id: businessId, estimate: { ...record, status } } } });
  const outcome = (action, status = "DRAFT") => ({ data: { [`estimate${action}`]: { didSucceed: true, inputErrors: [], estimate: { ...record, status } } } });
  const details = { customerId: customer.id, items: [{ productId: "product-one", unitPrice: "10.25000001", taxes: [] }] };
  state.responses = [owner, outcome("Create")];
  assert.equal((await service.invoke({ ...input, operation: "estimates.create", input: { businessId, input: details } })).data.estimateCreate.estimate.total.value, "10.25000001");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { input: { ...details, status: "DRAFT", businessId } });
  assert.match(JSON.parse(requests.at(-1).init.body).query, /\$input: EstimateCreateInput!/);
  const patch = { id: record.id, customerId: customer.id, status: "DRAFT", title: "Revised estimate", currency: "USD",
    estimateDate: record.estimateDate, dueDate: record.dueDate, exchangeRate: "1", memo: "Updated" };
  state.responses = [existing("DRAFT"), owner, outcome("Patch")];
  await service.invoke({ ...input, operation: "estimates.update", input: { businessId, input: patch } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { input: patch });
  state.responses = [existing("DRAFT"), outcome("Approve", "APPROVED")];
  await service.invoke({ ...input, operation: "estimates.approve", input: { businessId, input: { estimateId: record.id } } });
  assert.match(JSON.parse(requests.at(-1).init.body).query, /estimateApprove/);
  const send = { estimateId: record.id, to: ["customer@example.test"], attachPDF: true };
  state.responses = [existing("APPROVED"), { data: { estimateSend: { didSucceed: true, inputErrors: [] } } }];
  assert.equal((await service.invoke({ ...input, operation: "estimates.send", input: { businessId, input: send } })).data.estimateSend.didSucceed, true);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { input: send });
  state.responses = [existing("APPROVED")];
  assert.equal((await service.invoke({ ...input, operation: "estimates.get", input: { businessId, estimateId: record.id } })).data.business.estimate.id, record.id);
  state.responses = [{ data: { business: { id: businessId, estimates: page([record]) } } }];
  await service.invoke({ ...input, operation: "estimates.list", input: { businessId } });
  assert.match(JSON.parse(requests.at(-1).init.body).query, /sort: CREATED_AT_DESC/);
  for (const status of ["DRAFT", "DELETED", "CONVERTED", null]) {
    state.responses = [existing(status)]; const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "estimates.send", input: { businessId, input: send } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, count + 1);
  }
  state.responses = [existing("APPROVED"), { data: { estimateSend: { didSucceed: false, inputErrors: [{ code: "INVALID", path: ["to"] }] } } }];
  const count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "estimates.send", input: { businessId, input: send } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count + 2);
});

test("Wave estimates reject incomplete accounting values and cross-business results", async t => {
  const { service, state, requests, connect } = await fixture(t, [...scopes, "estimate:*"]);
  await connect();
  for (const values of [
    { customerId: customer.id, items: [{ productId: "product-one" }] },
    { customerId: customer.id, items: [{ productId: "product-one", unitPrice: 10.25 }] },
    { customerId: customer.id, status: "SAVED", items: [{ productId: "product-one", unitPrice: "10" }] }
  ]) {
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "estimates.create", input: { businessId, input: values } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, count);
  }
  let count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "estimates.update", input: { businessId, input: { id: "estimate-one", memo: "Insufficient" } } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  const wrong = { id: "estimate-one", customer: { id: customer.id, business: { id: "other-business" } }, status: "APPROVED" };
  state.responses = [{ data: { business: { id: businessId, estimate: wrong } } }];
  count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "estimates.approve", input: { businessId, input: { estimateId: wrong.id } } }), { code: "connector_resource_not_found" });
  assert.equal(requests.length, count + 1);
  state.responses = [{ data: { business: { id: businessId, estimate: wrong } } }];
  await assert.rejects(service.invoke({ ...input, operation: "estimates.get", input: { businessId, estimateId: wrong.id } }), { code: "connector_response_invalid" });
  state.responses = [{ data: { business: { id: businessId, estimates: page([wrong]) } } }];
  await assert.rejects(service.invoke({ ...input, operation: "estimates.list", input: { businessId } }), { code: "connector_response_invalid" });
});

test("Wave product writes verify related records and preserve explicit decimal prices", async t => {
  const { service, state, requests, connect } = await fixture(t, [...scopes, "product:*", "account:read", "sales_tax:read"]);
  await connect();
  const owner = id => ({ data: { business: { id: businessId, record: { id, business: { id: businessId } } } } });
  const record = { id: "product-one", name: "Grooming", unitPrice: "125.12345", business: { id: businessId } };
  const outcome = action => ({ data: { [`product${action}`]: { didSucceed: true, inputErrors: [], product: record } } });
  const details = { name: record.name, unitPrice: record.unitPrice, incomeAccountId: "income-one", defaultSalesTaxIds: ["tax-one"] };
  state.responses = [owner("income-one"), owner("tax-one"), outcome("Create")];
  const created = await service.invoke({ ...input, operation: "products.create", input: { businessId, input: details } });
  assert.equal(created.data.productCreate.product.unitPrice, record.unitPrice);
  assert.match(JSON.parse(requests.at(-3).init.body).query, /record: account/);
  assert.match(JSON.parse(requests.at(-2).init.body).query, /record: salesTax/);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { input: { ...details, businessId } });
  state.responses = [owner(record.id), outcome("Patch")];
  await service.invoke({ ...input, operation: "products.update", input: { businessId, input: { id: record.id, defaultSalesTaxIds: [] } } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { input: { id: record.id, defaultSalesTaxIds: [] } });
  for (const bad of [{ ...details, unitPrice: 125 }, { ...details, unitPrice: "1.123456" }, { ...details, defaultSalesTaxIds: ["tax-one", "tax-one"] }]) {
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "products.create", input: { businessId, input: bad } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, count);
  }
  state.responses = [{ data: { business: { id: businessId, record: { id: "income-one", business: { id: "other" } } } } }];
  let count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "products.create", input: { businessId, input: details } }), { code: "connector_resource_not_found" });
  assert.equal(requests.length, count + 1);
  state.responses = [owner(record.id), { data: { productPatch: { didSucceed: false, inputErrors: [{ code: "INVALID", path: ["name"] }], product: null } } }];
  count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "products.update", input: { businessId, input: { id: record.id, name: "New" } } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count + 2);
  state.responses = [owner(record.id), { data: { productPatch: { didSucceed: true, inputErrors: [], product: { ...record, id: "different-product" } } } }];
  await assert.rejects(service.invoke({ ...input, operation: "products.update", input: { businessId, input: { id: record.id, name: "New" } } }), { code: "connector_response_invalid" });
});

test("Wave accounting writes preserve account revisions and dated decimal tax rates", async t => {
  const { service, state, requests, connect } = await fixture(t, [...scopes, "account:*", "sales_tax:*"]);
  await connect();
  const account = { id: "account-one", name: "Grooming revenue", sequence: 2, currency: { code: "USD" }, subtype: { value: "INCOME" }, isArchived: false, business: { id: businessId } };
  const tax = { id: "tax-one", name: "Sales tax", abbreviation: "GST", rate: "0.1", rates: [{ effective: "2026-01-01", rate: "0.1" }], isArchived: false, business: { id: businessId } };
  for (const [resource, plural, record, create, patch] of [
    ["account", "accounts", account, { name: account.name, subtype: "INCOME" }, { id: account.id, sequence: 2, name: "Services" }],
    ["salesTax", "salesTaxes", tax, { name: tax.name, abbreviation: "GST", rate: "0.1" }, { id: tax.id, rates: [{ effective: "2026-10-01", rate: "0.15" }] }]
  ]) {
    const outcome = action => ({ data: { [`${resource}${action}`]: { didSucceed: true, inputErrors: [], [resource]: record } } });
    const owner = { data: { business: { id: businessId, record } } };
    state.responses = [outcome("Create")];
    await service.invoke({ ...input, operation: `${plural}.create`, input: { businessId, input: create } });
    assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { input: { ...create, businessId } });
    state.responses = [{ data: { business: { id: businessId, [resource]: record } } }];
    assert.deepEqual((await service.invoke({ ...input, operation: `${plural}.get`, input: { businessId, [`${resource}Id`]: record.id } })).data.business[resource], record);
    state.responses = [owner, outcome("Patch")];
    await service.invoke({ ...input, operation: `${plural}.update`, input: { businessId, input: patch } });
    assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { input: patch });
    state.responses = [{ data: { business: { id: businessId, record: { ...record, business: { id: "other" } } } } }];
    let count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: `${plural}.update`, input: { businessId, input: patch } }), { code: "connector_resource_not_found" });
    assert.equal(requests.length, count + 1);
    state.responses = [owner, { data: { [`${resource}Patch`]: { didSucceed: false, inputErrors: [{ code: "INVALID", path: ["name"] }] } } }];
    count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: `${plural}.update`, input: { businessId, input: patch } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, count + 2);
  }
  state.responses = [{ data: { business: { id: businessId, record: account } } }];
  let count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "accounts.update", input: { businessId, input: { id: account.id, sequence: 1, name: "Stale" } } }), { code: "connector_conflict" });
  assert.equal(requests.length, count + 1);
  for (const rate of [0.1, "0.1234567", "-0.1"]) {
    count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "salesTaxes.create", input: { businessId, input: { name: "GST", abbreviation: "GST", rate } } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, count);
  }
  count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "accounts.create", input: { businessId, input: { name: "System", subtype: "UNKNOWN_ACCOUNT" } } }), { code: "connector_input_invalid" });
  await assert.rejects(service.invoke({ ...input, operation: "salesTaxes.update", input: { businessId, input: { id: tax.id, rates: [{ effective: "2026-02-30", rate: "0.1" }] } } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
});

test("Wave records deliberate money transactions with related ownership checks and no write replay", async t => {
  const { service, state, requests, connect } = await fixture(t, [...scopes, "transaction:write", "account:read", "sales_tax:read"]);
  await connect();
  const owner = id => ({ data: { business: { id: businessId, record: { id, business: { id: businessId } } } } });
  const details = { externalId: "receipt-2026-001", date: "2026-09-13", description: "Grooming sale",
    anchor: { accountId: "bank", amount: "110.00", direction: "DEPOSIT" },
    lineItems: [{ accountId: "sales", amount: "100.00", balance: "INCREASE", customerId: customer.id,
      taxes: [{ salesTaxId: "gst", amount: "10.00" }] }] };
  const related = () => [owner("bank"), owner("sales"), owner(customer.id), owner("gst")];
  const accepted = { data: { moneyTransactionCreate: { didSucceed: true, inputErrors: [], transaction: { id: "transaction-one" } } } };
  state.responses = [...related(), accepted];
  const created = await service.invoke({ ...input, operation: "transactions.create", input: { businessId, input: details } });
  assert.equal(created.data.moneyTransactionCreate.transaction.id, "transaction-one");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { input: { ...details, businessId } });
  assert.match(JSON.parse(requests.at(-1).init.body).query, /MoneyTransactionCreateInput!/);
  for (const bad of [{ ...details, externalId: "" }, { ...details, lineItems: [] },
    { ...details, anchor: { ...details.anchor, amount: 110 } },
    { ...details, anchor: { ...details.anchor, amount: "-110" } },
    { ...details, anchor: { ...details.anchor, amount: "1.001" } }]) {
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "transactions.create", input: { businessId, input: bad } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, count);
  }
  state.responses = [{ data: { business: { id: businessId, record: { id: "bank", business: { id: "other" } } } } }];
  let count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "transactions.create", input: { businessId, input: details } }), { code: "connector_resource_not_found" });
  assert.equal(requests.length, count + 1);
  state.responses = [...related(), { data: { moneyTransactionCreate: { didSucceed: false, inputErrors: [{ code: "UNBALANCED", path: ["lineItems"] }], transaction: null } } }];
  count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "transactions.create", input: { businessId, input: details } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count + 5);
  assert.equal(requests.slice(count).filter(r => JSON.parse(r.init.body).query.startsWith("mutation ")).length, 1);
});


test("Wave ownership preflights preserve reconnect errors and never submit the write", async (t) => {
  for (const [operation, args] of [
    ["customers.update", { businessId, input: { id: customer.id, name: "Changed" } }],
    ["products.update", { businessId, input: { id: "product-one", name: "Changed" } }],
    ["accounts.update", { businessId, input: { id: "account-one", sequence: 1, name: "Changed" } }],
    ["invoices.approve", { businessId, input: { invoiceId: invoice.id } }],
    ["estimates.approve", { businessId, input: { estimateId: "estimate-one" } }]
  ]) {
    const { service, state, requests, connect } = await fixture(t, ["user:read", "business:read", "customer:*", "product:*", "account:*", "invoice:*", "estimate:*"]);
    await connect();
    state.response = { errors: [{ message: "fixture-wave-secret", extensions: { code: "UNAUTHENTICATED" } }] };
    const before = requests.length;
    await assert.rejects(service.invoke({ ...input, operation, input: args }), error => {
      assert.equal(error.code, "connector_reconnect_required");
      assert.equal(error.message.includes("fixture-wave-secret"), false);
      return true;
    });
    assert.equal(requests.length, before + 1);
    assert.equal((await service.status(input)).status, "reconnect-required");
  }
});


test("Wave archives an account only in its verified business, with no write retry", async (t) => {
  const { service, state, requests, connect } = await fixture(t, ["user:read", "business:read", "account:*"]);
  await connect();
  const owner = { data: { business: { id: businessId, record: { id: "account-one", business: { id: businessId }, sequence: 4 } } } };
  const invoke = () => service.invoke({ ...input, operation: "accounts.archive", input: { businessId, input: { id: "account-one" } } });
  state.responses = [owner, { data: { accountArchive: { didSucceed: true, inputErrors: [] } } }];
  const before = requests.length;
  await invoke();
  assert.equal(requests.length, before + 2);
  const body = JSON.parse(requests.at(-1).init.body);
  assert.deepEqual(body.variables, { input: { id: "account-one" } });
  assert.match(body.query, /accountArchive/);
  assert.doesNotMatch(body.query, /account \{/);
  state.response = { data: { business: { id: "another-business" } } };
  const denied = requests.length;
  await assert.rejects(invoke(), { code: "connector_resource_not_found" });
  assert.equal(requests.length, denied + 1);
  state.responses = [owner, { data: { accountArchive: { didSucceed: false, inputErrors: [{ code: "FORBIDDEN", path: ["id"] }] } } }];
  const rejected = requests.length;
  await assert.rejects(invoke(), { code: "connector_input_invalid" });
  assert.equal(requests.length, rejected + 2);
});
