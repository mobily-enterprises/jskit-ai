import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { prestashopProvider } from "../src/server/prestashop.js";

const context = { applicationId: "store-app", subjectId: "merchant" };
const input = { context, integrationId: "store" };
const products = { products: [{ id: "42", reference: "SHIRT", price: "20.000000", active: "1",
  name: [{ id: 1, value: "Shirt" }, { id: 2, value: "Chemise" }],
  associations: { images: [{ id: "7" }] } }] };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "prestashop-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(5) }, activeKeyId: "current" });
  const requests = [];
  const state = { secret: "fixture-prestashop-webservice-key", response: products, status: 200, fail: false };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { store: {
      provider: "prestashop", displayName: "My store", accountMode: "shared", scopes: [],
      authentication: { method: "api-key", secretRef: "env:PRESTASHOP_WEBSERVICE_KEY" },
      settings: { siteUrl: "https://merchant.example:8443/store/" }
    } }, extensions: { fromCli: true } },
    providers: [prestashopProvider], authorize: async (owner) => owner,
    resolveReference: async (reference) => { assert.equal(reference, "env:PRESTASHOP_WEBSERVICE_KEY"); return state.secret; },
    store: createFileConnectionStore({ directory, protection }),
    fetchImpl: async (address, init) => {
      requests.push({ url: new URL(String(address)), init, headers: new Headers(init.headers) });
      if (state.fail) throw new Error(state.secret);
      return Response.json(state.response, { status: state.status, headers: { Link: '<https://unrelated.example/next>; rel="next"' } });
    }
  };
  return { service: createConnectionService(options), options, directory, protection, requests, state };
}

test("PrestaShop verifies product reads with header-only Basic authentication, then survives file restart and key rotation", async (t) => {
  const { service, options, directory, protection, requests, state } = await fixture(t);
  const connected = await service.connectApiKey(input);
  assert.equal(connected.status, "connected");
  assert.equal(requests[0].url.origin, "https://merchant.example:8443");
  assert.equal(requests[0].url.pathname, "/store/api/products");
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), {
    output_format: "JSON", display: "full", sort: "[id_ASC]", limit: "0,20"
  });
  assert.equal(requests[0].headers.get("authorization"), `Basic ${Buffer.from(`${state.secret}:`).toString("base64")}`);
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].init.credentials, "omit");
  assert.equal(requests[0].headers.has("cookie"), false);
  assert.equal(requests[0].url.href.includes(state.secret), false);
  assert.equal(JSON.stringify(connected).includes(state.secret), false);
  for (const name of await readdir(directory)) {
    const text = await readFile(path.join(directory, name), "utf8");
    assert.equal(text.includes(state.secret), false);
    assert.equal(text.includes(requests[0].headers.get("authorization")), false);
  }
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.status(input), connected);
  state.secret = "rotated-prestashop-webservice-key";
  assert.deepEqual(await restarted.invoke({ ...input, operation: "products.list" }), products);
  assert.equal(requests.at(-1).headers.get("authorization"), `Basic ${Buffer.from(`${state.secret}:`).toString("base64")}`);
  assert.equal(requests.length, 2, "Response links and associated resources are data, not follow-up requests.");
  await restarted.disconnect(input);
  assert.equal((await service.status(input)).status, "disconnected");
});

test("PrestaShop preserves multilingual product and decimal order values with bounded explicit pagination", async (t) => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  assert.deepEqual(await service.invoke({ ...input, operation: "products.list", input: { offset: 100, limit: 100, language: 2 } }), products);
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), {
    output_format: "JSON", display: "full", sort: "[id_ASC]", limit: "100,100", language: "2"
  });
  state.response = { orders: [{ id: 12, reference: "EXAMPLE", current_state: "2", total_paid: "20.000000", id_currency: "1" }] };
  assert.deepEqual(await service.invoke({ ...input, operation: "orders.list", input: { offset: 20, limit: 10 } }), state.response);
  assert.equal(requests.at(-1).url.pathname, "/store/api/orders");
  assert.equal(requests.at(-1).url.searchParams.get("limit"), "20,10");
  assert.equal(requests.at(-1).url.searchParams.has("language"), false);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ init }) => init.method === "GET" && init.body === undefined));
});

test("PrestaShop accepts the provider's empty JSON lists and rejects error or malformed envelopes", async (t) => {
  const { service, state } = await fixture(t);
  state.response = [];
  await service.connectApiKey(input);
  for (const resource of ["products", "orders"]) {
    for (const response of [[], { [resource]: [] }]) {
      state.response = response;
      assert.deepEqual(await service.invoke({ ...input, operation: `${resource}.list` }), response);
    }
    for (const response of [{}, [{}], { [resource]: [{}] }, { [resource]: [{ id: 0 }] }, { [resource]: [{ id: "1/evil" }] },
      { [resource]: [], errors: [{ message: state.secret }] }, { errors: [{ code: 20, message: state.secret }] }]) {
      state.response = response;
      await assert.rejects(service.invoke({ ...input, operation: `${resource}.list` }), (error) => {
        assert.equal(error.code, "connector_response_invalid");
        assert.equal(error.stack.includes(state.secret), false);
        return true;
      });
    }
  }
});

test("PrestaShop rejects invalid settings, raw keys and pagination or destination overrides before HTTP", async (t) => {
  const { service, options, requests } = await fixture(t);
  const parse = (configuration) => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [prestashopProvider] });
  assert.deepEqual(parse(options.configuration), options.configuration);
  for (const siteUrl of [undefined, "", "http://merchant.example", "https:merchant.example", "https://key@merchant.example",
    "https://merchant.example?key=secret", "https://merchant.example#fragment", "https://merchant.example/store/../", "https://merchant.example/%2e%2e/",
    "https://merchant.example\\@evil.example", "https://merchant.example/with space", "https://merchant.example:99999"]) {
    const configuration = structuredClone(options.configuration);
    configuration.integrations.store.settings.siteUrl = siteUrl;
    assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors["integrations.store.settings.siteUrl"]));
  }
  for (const siteUrl of ["https://merchant.example", "https://merchant.example/store/blog/", "https://[::1]:8443/store"]) {
    const configuration = structuredClone(options.configuration);
    configuration.integrations.store.settings.siteUrl = siteUrl;
    assert.equal(parse(configuration).integrations.store.settings.siteUrl, siteUrl);
    assert.ok(prestashopProvider.operations["products.list"].request({}, { siteUrl }).url.startsWith(`${siteUrl.replace(/\/+$/u, "")}/api/products?`));
  }
  const configuration = structuredClone(options.configuration);
  configuration.integrations.store.authentication.secretRef = "raw-secret";
  assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors["integrations.store.authentication.secretRef"]));
  assert.equal(requests.length, 0);
  await service.connectApiKey(input);
  for (const operation of ["products.list", "orders.list"]) {
    for (const value of [{ offset: -1 }, { offset: 1.5 }, { offset: 1000001 }, { limit: 0 }, { limit: 101 }, { limit: 1.5 },
      { language: 0 }, { language: 1.5 }, { url: "https://evil.example" }, { siteUrl: "https://evil.example" },
      { ws_key: "override" }, { output_format: "XML" }, { display: "full" }, { resource: "customers" }]) {
      await assert.rejects(service.invoke({ ...input, operation, input: value }), { code: "connector_input_invalid" });
    }
  }
  assert.equal(requests.length, 1);
});

test("PrestaShop isolates owners, rejects changed store bindings and enforces the configured origin", async (t) => {
  const { service, options, requests } = await fixture(t);
  await service.connectApiKey(input);
  for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-owner" }]) {
    await assert.rejects(service.invoke({ ...input, context: owner, operation: "products.list" }), { code: "connector_reconnect_required" });
  }
  for (const settings of [{ siteUrl: "https://other.example" }, { siteUrl: "https://merchant.example:8443/other-store" }]) {
    const configuration = structuredClone(options.configuration);
    configuration.integrations.store.settings = settings;
    const changed = createConnectionService({ ...options, configuration });
    assert.equal((await changed.status(input)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...input, operation: "products.list" }), { code: "connector_reconnect_required" });
  }
  const wrongHost = createConnectionService({ ...options, providers: [{ ...prestashopProvider, operations: {
    "products.list": { scopes: [], request: () => ({ method: "GET", url: "https://other.example/api/products" }) }
  } }] });
  await assert.rejects(wrongHost.invoke({ ...input, operation: "products.list" }), { code: "connector_destination_invalid" });
  const denied = createConnectionService({ ...options, authorize: async () => { throw new Error("Access denied"); } });
  await assert.rejects(denied.invoke({ ...input, operation: "orders.list" }), /Access denied/u);
  assert.equal(requests.length, 1);
});

test("PrestaShop exposes permission and rate-limit failures without claiming order permission or retrying requests", async (t) => {
  const { service, requests, state } = await fixture(t);
  for (const [status, code] of [[401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status;
    state.response = { errors: [{ message: state.secret }] };
    const count = requests.length;
    await assert.rejects(service.connectApiKey(input), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.stack.includes(state.secret), false);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal((await service.status(input)).status, "disconnected");
    assert.equal(requests.length, count + 1);
  }
  state.status = 200;
  state.response = products;
  await service.connectApiKey(input);
  state.status = 403;
  await assert.rejects(service.invoke({ ...input, operation: "orders.list" }), { code: "connector_permission_denied" });
  assert.equal((await service.status(input)).status, "connected");
  state.status = 401;
  await assert.rejects(service.invoke({ ...input, operation: "products.list" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("PrestaShop keeps transport failures and cancellation observable without a second request", async (t) => {
  const { service, options, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  state.fail = true;
  await assert.rejects(service.invoke({ ...input, operation: "products.list" }), (error) => {
    assert.equal(error.code, "connector_provider_failed");
    assert.equal(error.stack.includes(state.secret), false);
    return true;
  });
  assert.equal(requests.length, 2);
  const controller = new AbortController();
  let calls = 0;
  const interrupted = createConnectionService({ ...options, fetchImpl: async () => {
    calls++;
    controller.abort();
    throw new DOMException("Interrupted", "AbortError");
  } });
  await assert.rejects(interrupted.invoke({ ...input, operation: "products.list", signal: controller.signal }), { code: "connector_cancelled" });
  assert.equal(calls, 1);
});
