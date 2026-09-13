import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { chargebeeProvider } from "../src/server/chargebee.js";

const context = { applicationId: "billing-app", subjectId: "finance-team" };
const input = { context, integrationId: "billing" };
const customers = { list: [{ customer: { id: "customer-1", object: "customer", first_name: "Alex" } }] };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "chargebee-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(6) }, activeKeyId: "current" });
  const requests = [];
  const state = { key: "test_fixture_key", status: 200, response: customers };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { billing: {
      provider: "chargebee", accountMode: "shared", scopes: [],
      authentication: { method: "api-key", secretRef: "env:CHARGEBEE_API_KEY" },
      settings: { siteName: "acme-test" }, extensions: { fromCli: true }
    } } },
    providers: [chargebeeProvider], authorize: async (owner) => state.deny ? null : owner,
    store: createFileConnectionStore({ directory, protection }),
    resolveReference: async (ref) => { assert.equal(ref, "env:CHARGEBEE_API_KEY"); return state.key; },
    fetchImpl: async (address, init) => {
      requests.push({ url: new URL(String(address)), init, headers: new Headers(init.headers) });
      if (state.fail) throw new Error("uncertain write");
      return Response.json(state.response, { status: state.status });
    }
  };
  return { service: createConnectionService(options), options, requests, directory, protection, state };
}

test("Chargebee verifies a site with Basic API-key authentication and retains file ownership across restart", async (t) => {
  const { service, options, requests, directory, protection, state } = await fixture(t);
  const connected = await service.connectApiKey(input);
  assert.equal(connected.status, "connected");
  const first = requests[0];
  assert.equal(first.url.href, "https://acme-test.chargebee.com/api/v2/customers?limit=10&include_deleted=false");
  assert.equal(first.init.method, "GET");
  assert.equal(first.init.body, undefined);
  assert.equal(first.init.redirect, "error");
  assert.equal(first.headers.get("authorization"), `Basic ${Buffer.from(`${state.key}:`).toString("base64")}`);
  for (const name of await readdir(directory)) {
    const stored = await readFile(path.join(directory, name), "utf8");
    assert.doesNotThrow(() => JSON.parse(stored));
    assert.equal(stored.includes(state.key), false);
    assert.equal(stored.includes(first.headers.get("authorization")), false);
  }
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.status(input), connected);
  state.key = "test_rotated_key";
  assert.deepEqual(await restarted.invoke({ ...input, operation: "customers.list" }), customers);
  assert.equal(requests.at(-1).headers.get("authorization"), `Basic ${Buffer.from(`${state.key}:`).toString("base64")}`);
  for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-team" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "customers.list" }), { code: "connector_reconnect_required" });
  }
  assert.equal(requests.length, 2);
  await restarted.disconnect(input);
  assert.equal((await service.status(input)).status, "disconnected");
});

test("Chargebee rejects full URLs and invalid site labels or Basic credential separators before HTTP", async (t) => {
  const { service, options, requests, state } = await fixture(t);
  const parse = (configuration) => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [chargebeeProvider] });
  for (const siteName of [undefined, "", "https://acme-test.chargebee.com", "acme.chargebee.com", "user@host", "acme/..", "acme?host=other", "acme#fragment", "acme:443", "-acme", "acme-", "a_b", "with space", "a".repeat(64)]) {
    const configuration = structuredClone(options.configuration);
    configuration.integrations.billing.settings.siteName = siteName;
    assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors["integrations.billing.settings.siteName"]));
  }
  const configuration = structuredClone(options.configuration);
  configuration.integrations.billing.authentication.secretRef = "raw-key";
  assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors["integrations.billing.authentication.secretRef"]));
  for (const key of ["key:password", "key with space", "key\nheader", "key\u0000"]) {
    state.key = key;
    await assert.rejects(service.connectApiKey(input), { code: "connector_binding_missing" });
  }
  assert.equal(requests.length, 0);
});

test("Chargebee site changes require verification and never fall back across sites", async (t) => {
  const { service, options, requests } = await fixture(t);
  await service.connectApiKey(input);
  const configuration = structuredClone(options.configuration);
  configuration.integrations.billing.settings.siteName = "acme-live";
  const changed = createConnectionService({ ...options, configuration });
  assert.equal((await changed.status(input)).status, "reconnect-required");
  await assert.rejects(changed.invoke({ ...input, operation: "customers.list" }), { code: "connector_reconnect_required" });
  const wrongHost = createConnectionService({ ...options, providers: [{ ...chargebeeProvider, operations: {
    "customers.list": { scopes: [], request: () => ({ method: "GET", url: "https://acme-live.chargebee.com/api/v2/customers" }) }
  } }] });
  await assert.rejects(wrongHost.invoke({ ...input, operation: "customers.list" }), { code: "connector_destination_invalid" });
  assert.equal(requests.length, 1);
  await changed.connectApiKey(input);
  assert.equal(requests.at(-1).url.origin, "https://acme-live.chargebee.com");
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Chargebee preserves opaque customer pagination and opt-in deleted records while rejecting input overrides", async (t) => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  state.response = { list: [{ customer: { id: "deleted-1", deleted: true } }], next_offset: "next+&=cursor" };
  assert.deepEqual(await service.invoke({ ...input, operation: "customers.list", input: { limit: 100, offset: "previous+&=cursor", include_deleted: true } }), state.response);
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { limit: "100", offset: "previous+&=cursor", include_deleted: "true" });
  for (const invalid of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: "" }, { offset: "x".repeat(1001) }, { include_deleted: "maybe" }, { siteName: "other-site" }, { url: "https://attacker.invalid" }, { api_key: "other-key" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "customers.list", input: invalid }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, 2);
  state.response = { list: [] };
  assert.deepEqual(await service.invoke({ ...input, operation: "customers.list" }), { list: [] });
});

test("Chargebee failure responses never verify a key or expose provider details and revoked keys require reconnection", async (t) => {
  const { service, state } = await fixture(t);
  for (const [status, code] of [[200, "connector_response_invalid"], [401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status;
    state.response = { message: state.key, api_error_code: "provider-fixture-error" };
    await assert.rejects(service.connectApiKey(input), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes(state.key), false);
      assert.equal(JSON.stringify(error).includes(state.key), false);
      return true;
    });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  state.status = 200;
  state.response = customers;
  await service.connectApiKey(input);
  for (const malformed of [{ list: {} }, { list: [{}] }, { list: [{ customer: { id: "" } }] }, { ...customers, next_offset: 2 }, { ...customers, next_offset: "x".repeat(1001) }]) {
    state.response = malformed;
    await assert.rejects(service.invoke({ ...input, operation: "customers.list" }), { code: "connector_response_invalid" });
  }
  state.status = 401;
  await assert.rejects(service.invoke({ ...input, operation: "customers.list" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});


test("Chargebee app billing uses indexed forms, explicit idempotency and verified checkout state", async t => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  const invoke = (operation, values = {}) => service.invoke({ ...input, operation, input: values });
  const items = [{ item_price_id: "grooming-USD-monthly", quantity: 1 }];
  const returns = { redirect_url: "https://app.example/billing/return", cancel_url: "https://app.example/billing/cancel" };
  const samples = [
    ["customers.create", "customers", { email: "sam@example.test", first_name: "Sam", id: "customer-1" }, { customer: { id: "customer-1" } }],
    ["customers.update", "customers/customer-1", { resource: "customer-1", company: "Dog and Groom" }, { customer: { id: "customer-1", company: "Dog and Groom" } }],
    ["subscriptions.create", "customers/customer-1/subscription_for_items", { resource: "customer-1", subscription_items: items, auto_collection: "off", invoice_immediately: false }, { subscription: { id: "sub-1", status: "active" }, unbilled_charges: [{ id: "charge-1" }] }],
    ["subscriptions.updateAtTermEnd", "subscriptions/sub-1/update_for_items", { resource: "sub-1", subscription_items: items, replace_items_list: true }, { subscription: { id: "sub-1", has_scheduled_changes: true } }, { end_of_term: "true" }],
    ["subscriptions.cancelAtTermEnd", "subscriptions/sub-1/cancel_for_items", { resource: "sub-1" }, { subscription: { id: "sub-1", status: "non_renewing" } }, { cancel_option: "end_of_term" }],
    ["hostedPages.checkoutNew", "hosted_pages/checkout_new_for_items", { subscription_items: items, customer: { id: "customer-1" }, ...returns }, { hosted_page: { id: "page-1", state: "created", url: "https://acme-test.chargebee.com/pages/v3/fixture" } }],
    ["hostedPages.checkoutExisting", "hosted_pages/checkout_existing_for_items", { subscription_items: items, subscription: { id: "sub-1" }, ...returns }, { hosted_page: { id: "page-2", state: "created" } }],
    ["portalSessions.create", "portal_sessions", { customer: { id: "customer-1" }, redirect_url: returns.redirect_url }, { portal_session: { id: "portal-1", access_url: "https://acme-test.chargebeeportal.com/fixture" } }],
    ["invoices.pdf", "invoices/invoice-1/pdf", { resource: "invoice-1", disposition_type: "attachment" }, { download: { download_url: "https://downloads.example/invoice.pdf", valid_till: 1789290000 } }]
  ];
  for (const [operation, endpoint, values, response, fixed = {}] of samples) {
    state.response = response;
    assert.deepEqual(await invoke(operation, { ...values, idempotencyKey: `intent-${operation.replaceAll(".", "-")}` }), response);
    const request = requests.at(-1); assert.equal(request.init.method, "POST"); assert.equal(request.url.href, `https://acme-test.chargebee.com/api/v2/${endpoint}`);
    assert.equal(request.headers.get("content-type"), "application/x-www-form-urlencoded");
    assert.equal(request.headers.get("chargebee-idempotency-key"), `intent-${operation.replaceAll(".", "-")}`);
    const body = new URLSearchParams(request.init.body); assert.equal(body.has("idempotencyKey"), false); assert.equal(body.has("resource"), false);
    for (const [key, value] of Object.entries(fixed)) assert.equal(body.get(key), value);
    if (values.subscription_items) { assert.equal(body.get("subscription_items[item_price_id][0]"), items[0].item_price_id); assert.equal(body.get("subscription_items[quantity][0]"), "1"); }
    if (values.customer) assert.equal(body.get("customer[id]"), values.customer.id);
    if (values.subscription) assert.equal(body.get("subscription[id]"), values.subscription.id);
    if (values.auto_collection) { assert.equal(body.get("auto_collection"), "off"); assert.equal(body.get("invoice_immediately"), "false"); }
  }
  for (const [operation, endpoint, resourceKey] of [["itemFamilies.list", "item_families", "item_family"], ["items.list", "items", "item"], ["itemPrices.list", "item_prices", "item_price"], ["subscriptions.list", "subscriptions", "subscription"], ["invoices.list", "invoices", "invoice"], ["events.list", "events", "event"]]) {
    state.response = { list: [{ [resourceKey]: { id: "resource-1" } }], next_offset: "opaque+next" };
    assert.deepEqual(await invoke(operation, { offset: "previous+cursor" }), state.response);
    assert.equal(requests.at(-1).url.pathname, `/api/v2/${endpoint}`); assert.equal(requests.at(-1).url.searchParams.get("offset"), "previous+cursor");
  }
  for (const [operation, endpoint, resourceKey] of [["customers.get", "customers", "customer"], ["items.get", "items", "item"], ["itemPrices.get", "item_prices", "item_price"], ["subscriptions.get", "subscriptions", "subscription"], ["invoices.get", "invoices", "invoice"], ["events.get", "events", "event"], ["hostedPages.get", "hosted_pages", "hosted_page"]]) {
    state.response = { [resourceKey]: { id: "resource-1", state: "succeeded", content: { subscription: { id: "sub-1", customer_id: "customer-1" }, invoice: { id: "invoice-1", status: "payment_due" } } } };
    assert.deepEqual(await invoke(operation, { resource: "resource-1" }), state.response);
    assert.equal(requests.at(-1).url.pathname, `/api/v2/${endpoint}/resource-1`); assert.equal(requests.at(-1).init.method, "GET");
  }
  const before = requests.length;
  for (const [operation, values] of [["customers.create", { email: "sam@example.test" }], ["subscriptions.create", { resource: "c", subscription_items: items, idempotencyKey: "x" }],
    ["hostedPages.checkoutNew", { subscription_items: [], customer: { id: "c" }, ...returns, idempotencyKey: "x" }],
    ["subscriptions.cancelAtTermEnd", { resource: "../other", idempotencyKey: "x" }],
    ["subscriptions.cancelAtTermEnd", { resource: "sub-1", idempotencyKey: "x", cancel_option: "immediately" }]]) await assert.rejects(invoke(operation, values), { code: "connector_input_invalid" });
  state.deny = true; await assert.rejects(invoke("portalSessions.create", { customer: { id: "customer-1" }, redirect_url: returns.redirect_url, idempotencyKey: "portal" }), { code: "connector_access_denied" }); state.deny = false;
  assert.equal(requests.length, before);
  const cancel = { resource: "sub-1", idempotencyKey: "same-intent" };
  state.response = { subscription: {} }; await assert.rejects(invoke("subscriptions.cancelAtTermEnd", cancel), { code: "connector_response_invalid" });
  for (const status of [403, 409, 422, 429, 500]) { state.status = status; await assert.rejects(invoke("subscriptions.cancelAtTermEnd", cancel)); }
  state.status = 200; state.fail = true; const uncertain = requests.length; await assert.rejects(invoke("subscriptions.cancelAtTermEnd", cancel)); assert.equal(requests.length, uncertain + 1);
});
