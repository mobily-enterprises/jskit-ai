import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { algoliaProvider } from "../src/server/algolia.js";

const context = { applicationId: "app-one", subjectId: "team-one" };
const input = { context, integrationId: "search" };
const indices = { items: [{ name: "products", entries: 20 }], nbPages: 2 };
const hits = { hits: [{ objectID: "product-1", name: "Phone" }], nbHits: 21, nbPages: 2, page: 0, hitsPerPage: 20 };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "algolia-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" });
  const requests = [];
  const references = [];
  const state = { key: "backend-fixture-secret", status: 200, response: indices };
  const options = {
    configuration: { schemaVersion: 1, integrations: {
      search: { provider: "algolia", accountMode: "shared", scopes: [],
        authentication: { method: "api-key", secretRef: "env:ALGOLIA_BACKEND_KEY" },
        settings: { applicationId: "APP123ABC", publicApiKeyRef: "env:ALGOLIA_PUBLIC_KEY" }, extensions: { keep: true } }
    }, registrations: {}, extensions: { fromCli: true } },
    providers: [algoliaProvider], authorize: async (owner) => owner,
    resolveReference: async (ref) => {
      references.push(ref);
      assert.equal(ref, "env:ALGOLIA_BACKEND_KEY");
      return state.key;
    },
    store: createFileConnectionStore({ directory, protection }),
    fetchImpl: async (address, init) => {
      requests.push({ url: new URL(String(address)), init, headers: new Headers(init.headers) });
      if (state.networkFailure) throw new Error("connection lost after write");
      return Response.json(state.response, { status: state.status });
    }
  };
  return { service: createConnectionService(options), options, directory, protection, requests, references, state };
}

test("Algolia persists a file connection, uses application headers and rotates only the backend key", async (t) => {
  const { service, options, directory, protection, requests, references, state } = await fixture(t);
  const connected = await service.connectApiKey(input);
  assert.equal(connected.status, "connected");
  const first = requests[0];
  assert.equal(first.url.href, "https://app123abc.algolia.net/1/indexes?page=0&hitsPerPage=100");
  assert.equal(first.headers.get("x-algolia-application-id"), "APP123ABC");
  assert.equal(first.headers.get("x-algolia-api-key"), state.key);
  assert.equal(first.init.redirect, "error");
  assert.equal(first.headers.has("authorization"), false);
  for (const name of await readdir(directory)) {
    assert.equal((await readFile(path.join(directory, name), "utf8")).includes(state.key), false);
  }
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.status(input), connected);
  state.key = "rotated-fixture-secret";
  assert.equal((await restarted.status(input)).status, "reconnect-required");
  assert.deepEqual(await restarted.invoke({ ...input, operation: "indices.list", input: { page: 1, hitsPerPage: 25 } }), indices);
  assert.equal(requests.at(-1).url.search, "?page=1&hitsPerPage=25");
  assert.equal(requests.at(-1).headers.get("x-algolia-api-key"), state.key);
  assert.equal((await restarted.status(input)).status, "connected");
  assert.deepEqual(new Set(references), new Set(["env:ALGOLIA_BACKEND_KEY"]));
  for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-team" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "indices.list" }), { code: "connector_reconnect_required" });
  }
  await restarted.disconnect(input);
  assert.equal((await service.status(input)).status, "disconnected");
});

test("Algolia validates portable application settings and keeps optional key references separate", async (t) => {
  const { options, requests } = await fixture(t);
  const parse = (configuration) => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [algoliaProvider] });
  assert.deepEqual(parse(options.configuration), options.configuration);
  for (const applicationId of [undefined, "", "app.attacker.invalid", "app/path", "x@host", "a-b", "x\r\ny", "x".repeat(64)]) {
    const config = structuredClone(options.configuration);
    config.integrations.search.settings.applicationId = applicationId;
    assert.throws(() => parse(config), (error) => Boolean(error.fieldErrors["integrations.search.settings.applicationId"]));
  }
  const config = structuredClone(options.configuration);
  config.integrations.search.settings.applicationId = " APP123ABC ";
  assert.equal(parse(config).integrations.search.settings.applicationId, "APP123ABC");
  config.integrations.search.settings.applicationId = "APP123ABC";
  config.integrations.search.settings.publicApiKeyRef = "frontend-value-is-not-a-reference";
  assert.throws(() => parse(config), (error) => Boolean(error.fieldErrors["integrations.search.settings.publicApiKeyRef"]));
  delete config.integrations.search.settings.publicApiKeyRef;
  assert.deepEqual(parse(config), config);
  assert.equal(requests.length, 0);
});

test("Algolia searches a named index with encoded paths, JSON parameters and response pagination", async (t) => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  state.response = hits;
  const result = await service.invoke({ ...input, operation: "index.search", input: { indexName: "products /?&", query: "phone + café", page: 1, hitsPerPage: 25 } });
  assert.deepEqual(result, hits);
  const request = requests.at(-1);
  assert.equal(request.url.href, "https://app123abc.algolia.net/1/indexes/products%20%2F%3F%26/query");
  assert.equal(request.init.method, "POST");
  assert.match(request.headers.get("content-type"), /application\/json/u);
  assert.deepEqual(JSON.parse(request.init.body), { query: "phone + café", page: 1, hitsPerPage: 25 });
  await service.invoke({ ...input, operation: "index.search", input: { indexName: "products" } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { query: "", page: 0, hitsPerPage: 20 });
  const count = requests.length;
  for (const invalid of [
    {}, { indexName: "" }, { indexName: "." }, { indexName: ".." }, { indexName: "x".repeat(256) },
    { indexName: "products", query: "é".repeat(257) }, { indexName: "products", hitsPerPage: 1001 },
    { indexName: "products", page: -1 }, { indexName: "products", apiKey: "caller-key" },
    { indexName: "products", url: "https://attacker.invalid" }
  ]) await assert.rejects(service.invoke({ ...input, operation: "index.search", input: invalid }), { code: "connector_input_invalid" });
  for (const invalid of [{ page: -1 }, { hitsPerPage: 0 }, { hitsPerPage: 1001 }, { page: null }, { url: "https://attacker.invalid" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "indices.list", input: invalid }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  await service.invoke({ ...input, operation: "index.search", input: { indexName: "products", query: "é".repeat(256), hitsPerPage: 1000 } });
});

test("Algolia rejects cross-application destinations and requires verification after configuration changes", async (t) => {
  const { service, options, requests } = await fixture(t);
  await service.connectApiKey(input);
  const wrongDestination = createConnectionService({ ...options, providers: [{ ...algoliaProvider, operations: {
    ...algoliaProvider.operations, "indices.list": { scopes: [], request: () => ({ method: "GET", url: "https://differentapp.algolia.net/1/indexes" }) }
  } }] });
  await assert.rejects(wrongDestination.invoke({ ...input, operation: "indices.list" }), { code: "connector_destination_invalid" });
  assert.equal(requests.length, 1);
  const configuration = structuredClone(options.configuration);
  configuration.integrations.search.settings.applicationId = "OTHERAPP";
  const changed = createConnectionService({ ...options, configuration });
  assert.equal((await changed.status(input)).status, "reconnect-required");
  await assert.rejects(changed.invoke({ ...input, operation: "indices.list" }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, 1);
  await changed.connectApiKey(input);
  assert.equal(requests.at(-1).url.origin, "https://otherapp.algolia.net");
  assert.equal(requests.at(-1).headers.get("x-algolia-application-id"), "OTHERAPP");
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Algolia failed verification and malformed responses never expose credentials or imply connection", async (t) => {
  const { service, state } = await fixture(t);
  for (const [status, code] of [[200, "connector_response_invalid"], [401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status;
    state.response = { message: state.key };
    await assert.rejects(service.connectApiKey(input), (error) => {
      assert.equal(error.code, code);
      assert.equal(JSON.stringify(error).includes(state.key), false);
      assert.equal(error.message.includes(state.key), false);
      return true;
    });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  state.status = 200;
  state.response = indices;
  await service.connectApiKey(input);
  for (const malformed of [{ items: [] }, { hits: [] }, { ...hits, page: "0" }]) {
    state.response = malformed;
    await assert.rejects(service.invoke({ ...input, operation: "index.search", input: { indexName: "products" } }), { code: "connector_response_invalid" });
  }
  state.status = 401;
  await assert.rejects(service.invoke({ ...input, operation: "indices.list" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});


test("Algolia indexes, partially updates and deletes records with explicit asynchronous completion", async t => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  state.response = { objectID: "product/1", taskID: 123, updatedAt: "2026-09-12T00:00:00Z" };
  const record = { indexName: "products / live", objectID: "product/1", attributes: { name: "Phone", price: 10 } };
  await service.invoke({ ...input, operation: "records.replace", input: record });
  assert.equal(requests.at(-1).init.method, "PUT");
  assert.equal(requests.at(-1).url.pathname, "/1/indexes/products%20%2F%20live/product%2F1");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), record.attributes);
  await service.invoke({ ...input, operation: "records.update", input: { ...record, attributes: { price: 9 } } });
  assert.equal(requests.at(-1).init.method, "POST");
  assert.equal(requests.at(-1).url.searchParams.get("createIfNotExists"), "false");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { price: 9 });
  const count = requests.length;
  for (const invalid of [{ ...record, attributes: {} }, { ...record, objectID: ".." },
    { ...record, attributes: { objectID: "other", price: 8 } }]) {
    await assert.rejects(service.invoke({ ...input, operation: "records.replace", input: invalid }));
  }
  assert.equal(requests.length, count);
  for (const status of ["notPublished", "published"]) {
    state.response = { status };
    assert.deepEqual(await service.invoke({ ...input, operation: "tasks.get", input: { indexName: record.indexName, taskID: 123 } }), { status });
  }
  assert.equal(requests.at(-1).url.pathname, "/1/indexes/products%20%2F%20live/task/123");
  state.response = { taskID: 124, deletedAt: "2026-09-12T00:00:00Z" };
  await service.invoke({ ...input, operation: "records.delete", input: { indexName: record.indexName, objectID: record.objectID } });
  assert.equal(requests.at(-1).init.method, "DELETE");
  state.status = 403;
  const beforeFailure = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "records.replace", input: record }));
  assert.equal(requests.length, beforeFailure + 1);
  state.status = 200;
  state.networkFailure = true;
  const beforeUncertainWrite = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "records.update", input: record }));
  assert.equal(requests.length, beforeUncertainWrite + 1);
  state.networkFailure = false;
  state.response = { status: "unknown" };
  await assert.rejects(service.invoke({ ...input, operation: "tasks.get", input: { indexName: record.indexName, taskID: 123 } }),
    { code: "connector_response_invalid" });
});
