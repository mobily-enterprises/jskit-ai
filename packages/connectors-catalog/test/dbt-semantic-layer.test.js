import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { dbtSemanticLayerProvider } from "../src/server/dbt-semantic-layer.js";

const context = { applicationId: "metrics-app", subjectId: "analytics-team" };
const input = { context, integrationId: "metrics" };
const environmentId = "9007199254740993";
const metric = { name: "order_total", description: null, type: "SIMPLE" };
const page = (items, values = {}) => ({ items, pageNum: 1, pageSize: 20, totalItems: items.length, totalPages: items.length ? 1 : 0, ...values });
async function fixture(t, host = "semantic-layer.cloud.getdbt.com") {
  const directory = await mkdtemp(path.join(tmpdir(), "dbt-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const state = { key: "fixture-dbt-token", status: 200, response: undefined, hang: false, resolutions: 0 };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { metrics: {
      provider: "dbt-semantic-layer", displayName: "Warehouse metadata", accountMode: "shared", scopes: [],
      settings: { host, environmentId }, authentication: { method: "api-key", secretRef: "env:DBT_SERVICE_TOKEN" }, extensions: { fromCli: true }
    } }, extensions: { retained: true } },
    providers: [{ ...dbtSemanticLayerProvider, requestTimeoutMs: 50 }],
    authorize: async (owner) => owner,
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(9) }, activeKeyId: "current" }) }),
    resolveReference: async (reference) => { state.resolutions++; assert.equal(reference, "env:DBT_SERVICE_TOKEN"); return state.key; },
    fetchImpl: async (address, init) => {
      init.signal.throwIfAborted();
      const body = JSON.parse(init.body);
      requests.push({ url: String(address), init, body, headers: new Headers(init.headers) });
      if (state.hang) {
        state.started?.();
        return new Promise((_, reject) => {
          if (init.signal.aborted) reject(init.signal.reason);
          else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        });
      }
      let data = { environmentInfo: { dialect: "SNOWFLAKE" } };
      for (const [name, items] of [["metricsPaginated", [metric]], ["dimensionsPaginated", [{ name: "metric_time", description: "Metric date", type: "TIME" }]], ["savedQueriesPaginated", [{ name: "orders", description: null }]]]) {
        if (body.query.includes(name)) data = { [name]: page(items, { pageNum: body.variables.pageNum, pageSize: body.variables.pageSize }) };
      }
      return Response.json(state.response === undefined ? { data } : state.response, { status: state.status });
    }
  };
  return { service: createConnectionService(options), options, state, requests, directory };
}

test("dbt verifies only environment metadata and preserves file-backed ownership, references and exact large IDs", async (t) => {
  const f = await fixture(t);
  const connected = await f.service.connectApiKey(input);
  assert.equal(connected.status, "connected"); assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  assert.equal(request.url, "https://semantic-layer.cloud.getdbt.com/api/graphql");
  assert.equal(request.init.method, "POST"); assert.equal(request.init.redirect, "error"); assert.equal(request.init.credentials, "omit");
  assert.equal(request.headers.get("authorization"), "Bearer fixture-dbt-token");
  assert.deepEqual(request.body.variables, { environmentId });
  assert.match(request.body.query, /\$environmentId: BigInt!/u); assert(!request.body.query.includes("mutation"));
  for (const name of await readdir(f.directory)) assert(!(await readFile(path.join(f.directory, name), "utf8")).includes(f.state.key));
  const restarted = createConnectionService(f.options);
  assert.deepEqual(await restarted.status(input), connected);
  for (const owner of [{ ...context, applicationId: "other" }, { ...context, subjectId: "other" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "metrics.list" }), { code: "connector_reconnect_required" });
  }
  assert.equal(f.requests.length, 1);
  f.state.key = "rotated-dbt-token";
  await restarted.invoke({ ...input, operation: "metrics.list" });
  assert.equal(f.requests.at(-1).headers.get("authorization"), "Bearer rotated-dbt-token");
  await restarted.disconnect(input); assert.equal((await f.service.status(input)).status, "disconnected");
});

test("dbt uses each declared regional, single-tenant and multi-cell host without following caller-supplied URLs", async (t) => {
  for (const host of ["semantic-layer.emea.dbt.com", "semantic-layer.au.dbt.com", "semantic-layer.account123.getdbt.com", "account123.semantic-layer.us1.dbt.com"]) {
    const f = await fixture(t, host); await f.service.connectApiKey(input);
    assert.equal(f.requests[0].url, `https://${host}/api/graphql`);
  }
});

test("dbt metadata pages are explicit, accept empty pages and preserve future metric types and nullable descriptions", async (t) => {
  const f = await fixture(t); await f.service.connectApiKey(input);
  for (const [operation, key, extra] of [["metrics.list", "metricsPaginated", {}], ["dimensions.list", "dimensionsPaginated", { metrics: [{ name: "order_total" }] }], ["savedQueries.list", "savedQueriesPaginated", {}]]) {
    const values = { pageNum: 2, pageSize: 3, search: "order\" \\ query", ...extra };
    const items = key === "savedQueriesPaginated" ? [{ name: "orders", description: "" }] : [{ ...metric, type: "FUTURE_TYPE" }];
    f.state.response = { data: { [key]: page(items, { pageNum: 2, pageSize: 3, totalItems: 4, totalPages: 2 }) } };
    const before = f.requests.length;
    assert.deepEqual(await f.service.invoke({ ...input, operation, input: values }), f.state.response);
    assert.deepEqual(f.requests.at(-1).body.variables, { ...values, environmentId });
    assert.equal(f.requests.at(-1).body.query.includes(values.search), false); assert.equal(f.requests.length, before + 1);
    f.state.response = { data: { [key]: page([]) } };
    assert.deepEqual(await f.service.invoke({ ...input, operation, input: extra }), f.state.response);
  }
});

test("dbt rejects malformed IDs, hosts, credential literals and unimplemented auth modes through the CLI parser", async (t) => {
  const f = await fixture(t);
  const parse = (configuration) => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [dbtSemanticLayerProvider] });
  const parsed = parse(f.options.configuration);
  assert.equal(parsed.integrations.metrics.settings.environmentId, environmentId);
  assert.deepEqual(parsed.extensions, { retained: true }); assert.deepEqual(parsed.integrations.metrics.extensions, { fromCli: true });
  const bad = (change) => {
    const config = structuredClone(f.options.configuration); Object.assign(config.integrations.metrics, change);
    assert.throws(() => parse(config), (error) => Boolean(error.fieldErrors) && !error.fieldErrors.configuration);
  };
  for (const host of ["", "https://semantic-layer.cloud.getdbt.com", "semantic-layer.cloud.getdbt.com:443", "semantic-layer.cloud.getdbt.com/", "semantic-layer.cloud.getdbt.com?x=1", "semantic-layer.cloud.getdbt.com.evil.test", "127.0.0.1", "metadata.internal", "SEMANTIC-LAYER.cloud.getdbt.com", "semantic-layer.-bad.dbt.com"]) bad({ settings: { host, environmentId } });
  for (const id of ["", 123, "01", "0", "-1", "1.5", "1e15", " 123", "1".repeat(39)]) bad({ settings: { host: f.options.configuration.integrations.metrics.settings.host, environmentId: id } });
  for (const secretRef of ["dbtc_raw-token", "https://secret.test/key", ""]) bad({ authentication: { method: "api-key", secretRef } });
  bad({ accountMode: "per-user" }); bad({ scopes: ["metadata"] }); bad({ authentication: { method: "oauth2", registrationRef: "dbt" } });
  const assistant = structuredClone(f.options.configuration); assistant.integrations.metrics.accountMode = "assistant"; assert.equal(parse(assistant).integrations.metrics.accountMode, "assistant");
  assert.equal(f.requests.length, 0);
});

test("dbt validates pagination and nested metric inputs before transport and rejects arbitrary queries", async (t) => {
  const f = await fixture(t); await f.service.connectApiKey(input); const before = f.requests.length;
  for (const values of [{ pageNum: 0 }, { pageNum: 1.5 }, { pageNum: 2_147_483_648 }, { pageSize: 0 }, { pageSize: 101 }, { pageSize: 1.5 }, { search: "x".repeat(513) }, { environmentId: "other" }, { host: "other.test" }, { query: "mutation { createQuery }" }]) {
    await assert.rejects(f.service.invoke({ ...input, operation: "metrics.list", input: values }), { code: "connector_input_invalid" });
  }
  for (const metrics of [undefined, [], ["order_total"], [{}], [{ name: "" }], [{ name: "x".repeat(513) }], [{ name: "orders", sql: "other" }], Array.from({ length: 101 }, () => ({ name: "orders" }))]) {
    await assert.rejects(f.service.invoke({ ...input, operation: "dimensions.list", input: { metrics } }), { code: "connector_input_invalid" });
  }
  await assert.rejects(f.service.invoke({ ...input, operation: "query.create" }), { code: "connector_operation_unknown" });
  assert.equal(f.requests.length, before);
});

test("dbt rejects malformed metadata and inconsistent pages instead of accepting a false connection", async (t) => {
  const f = await fixture(t);
  for (const value of [null, {}, { data: null }, { data: { environmentInfo: null } }, { data: { environmentInfo: { dialect: 4 } } }, { data: { environmentInfo: { dialect: "" } } }, { data: { environmentInfo: { dialect: "DIALECT" } }, errors: {} }]) {
    f.state.response = value;
    await assert.rejects(f.service.connectApiKey(input), { code: "connector_response_invalid" });
    assert.notEqual((await f.service.status(input)).status, "connected");
  }
  f.state.response = undefined; await f.service.connectApiKey(input);
  for (const result of [null, page([{}]), page([{ name: "metric", description: null }]), page([metric], { pageNum: 2 }), page([metric], { pageSize: 2 }), page([metric], { totalItems: 0 }), page([metric], { totalPages: -1 }), page([metric], { totalItems: 1.5 }), page([null])]) {
    f.state.response = { data: { metricsPaginated: result } };
    await assert.rejects(f.service.invoke({ ...input, operation: "metrics.list" }), { code: "connector_response_invalid" });
  }
  f.state.response = { data: { metricsPaginated: page([metric, metric], { pageSize: 1 }) } };
  await assert.rejects(f.service.invoke({ ...input, operation: "metrics.list", input: { pageSize: 1 } }), { code: "connector_response_invalid" });
});

test("dbt provider errors including partial GraphQL data are redacted without guessing authentication from message text", async (t) => {
  const f = await fixture(t); await f.service.connectApiKey(input);
  for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"], [401, "connector_reconnect_required"]]) {
    f.state.status = status; f.state.response = { error: f.state.key };
    await assert.rejects(f.service.invoke({ ...input, operation: "metrics.list" }), (error) => error.code === code && !JSON.stringify(error).includes(f.state.key) && error.cause === undefined);
  }
  assert.equal((await f.service.status(input)).status, "reconnect-required");
  f.state.status = 200; f.state.response = undefined; await f.service.connectApiKey(input);
  f.state.response = { data: { metricsPaginated: page([metric]) }, errors: [{ message: f.state.key }] };
  await assert.rejects(f.service.invoke({ ...input, operation: "metrics.list" }), (error) => error.code === "connector_provider_failed" && !error.message.includes(f.state.key));
});

test("dbt changing environment, host or token reference requires verification for the new configuration", async (t) => {
  const f = await fixture(t); await f.service.connectApiKey(input); const before = f.requests.length;
  for (const change of [{ settings: { host: "semantic-layer.au.dbt.com", environmentId } }, { settings: { host: f.options.configuration.integrations.metrics.settings.host, environmentId: "1" } }, { authentication: { method: "api-key", secretRef: "env:OTHER_TOKEN" } }]) {
    const configuration = structuredClone(f.options.configuration); Object.assign(configuration.integrations.metrics, change);
    const changed = createConnectionService({ ...f.options, configuration });
    assert.equal((await changed.status(input)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...input, operation: "metrics.list" }), { code: "connector_reconnect_required" });
  }
  assert.equal(f.requests.length, before);
});

test("dbt abort and timeout interrupt requests without replay or automatic page traversal", async (t) => {
  // The fake transport has no socket to keep Node 22 alive for an unrefed timeout.
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keepAlive));
  const f = await fixture(t); await f.service.connectApiKey(input); const before = f.requests.length;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.service.invoke({ ...input, operation: "metrics.list", signal: controller.signal }), { code: "connector_cancelled" });
  assert.equal(f.requests.length, before);
  f.state.hang = true; const started = new Promise((resolve) => { f.state.started = resolve; }); const running = new AbortController();
  const pending = assert.rejects(f.service.invoke({ ...input, operation: "metrics.list", signal: running.signal }), { code: "connector_cancelled" });
  await started; running.abort(); await pending;
  await assert.rejects(f.service.invoke({ ...input, operation: "metrics.list" }), { code: "connector_provider_timeout" });
  assert.equal(f.requests.length, before + 2);
});

test("dbt guide JSON is the actual CLI format and rejects missing or unsafe secret bindings before requests", async (t) => {
  const guide = await readFile(new URL("../docs/dbt-semantic-layer.md", import.meta.url), "utf8");
  const text = guide.match(/```json\n([\s\S]*?)\n```/u)[1];
  const configuration = parseIntegrationConfiguration(text, { providers: [dbtSemanticLayerProvider] });
  assert.equal(configuration.integrations.metrics.settings.environmentId, "70506183142324");
  assert.equal(configuration.integrations.metrics.authentication.secretRef, "env:DBT_SERVICE_TOKEN");
  const f = await fixture(t);
  for (const key of [undefined, "", "key with spaces", "key\nheader"]) {
    f.state.key = key; await assert.rejects(f.service.connectApiKey(input), { code: "connector_binding_missing" });
  }
  assert.equal(f.requests.length, 0);
});


test("dbt runs bounded metric queries with dimensions and time filters, then decodes explicit result pages without resubmitting", async (t) => {
  const f = await fixture(t); await f.service.connectApiKey(input);
  const values = { metrics: [{ name: "order_total", alias: "revenue" }], groupBy: [{ name: "metric_time", grain: "MONTH" }], where: [{ sql: "{{ Dimension('metric_time') }} >= '2026-01-01'" }], limit: 100 };
  f.state.response = { data: { createQuery: { queryId: "query-123" } } };
  assert.deepEqual(await f.service.invoke({ ...input, operation: "queries.create", input: values }), f.state.response);
  assert.deepEqual(f.requests.at(-1).body.variables, { ...values, environmentId });
  assert(!f.requests.at(-1).body.query.includes(values.where[0].sql));
  const before = f.requests.length;
  for (const bad of [{ ...values, metrics: [] }, { ...values, limit: 10001 }, { ...values, groupBy: [{ name: "metric_time", grain: "INVALID" }] }, { ...values, environmentId: "another" }]) {
    await assert.rejects(f.service.invoke({ ...input, operation: "queries.create", input: bad }), { code: "connector_input_invalid" });
  }
  assert.equal(f.requests.length, before);
  f.state.response = { data: { query: { status: "RUNNING", error: null, totalPages: null, jsonResult: null } } };
  assert.equal((await f.service.invoke({ ...input, operation: "queries.get", input: { queryId: "query-123" } })).data.query.status, "RUNNING");
  const table = { schema: { fields: [{ name: "revenue", type: "number" }] }, data: [{ revenue: 123.5 }] };
  f.state.response = { data: { query: { status: "SUCCESSFUL", error: null, totalPages: 2, jsonResult: JSON.stringify(table) } } };
  const result = await f.service.invoke({ ...input, operation: "queries.get", input: { queryId: "query-123", pageNum: 2 } });
  assert.deepEqual(result.data.query.jsonResult, table);
  assert.deepEqual(f.requests.at(-1).body.variables, { queryId: "query-123", pageNum: 2, environmentId });
  assert.match(f.requests.at(-1).body.query, /encoded: false/u);
  for (const jsonResult of ["{", "null", "[]", JSON.stringify({ schema: { fields: [] }, data: Array(1025).fill({}) }), "x".repeat(5 * 1024 * 1024 + 1), null]) {
    f.state.response = { data: { query: { status: "SUCCESSFUL", error: null, totalPages: 1, jsonResult } } };
    await assert.rejects(f.service.invoke({ ...input, operation: "queries.get", input: { queryId: "query-123" } }), { code: "connector_response_invalid" });
  }
  f.state.response = { data: { query: { status: "FAILED", error: f.state.key, totalPages: null, jsonResult: null } } };
  await assert.rejects(f.service.invoke({ ...input, operation: "queries.get", input: { queryId: "query-123" } }), error => error.code === "connector_provider_failed" && !error.message.includes(f.state.key));
  f.state.status = 500;
  const failedBefore = f.requests.length;
  await assert.rejects(f.service.invoke({ ...input, operation: "queries.create", input: values }), { code: "connector_provider_failed" });
  assert.equal(f.requests.length, failedBefore + 1);
});
