import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { clickhouseProvider } from "../src/server/clickhouse.js";

const context = { applicationId: "analytics-app", subjectId: "owner" };
const input = { context, integrationId: "warehouse" };
const checked = { meta: [{ name: "ok", type: "UInt8" }, { name: "user", type: "String" }], data: [{ ok: 1, user: "reader" }], rows: 1 };

async function fixture(t, authentication = { method: "api-key", secretRef: "env:CLICKHOUSE_PASSWORD" }) {
  const directory = await mkdtemp(path.join(tmpdir(), "clickhouse-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(5) }, activeKeyId: "current" });
  const requests = [];
  const resolutions = [];
  const state = { secret: "fixture:pässword", response: checked, status: 200, text: undefined };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { warehouse: {
      provider: "clickhouse", displayName: "Reports", accountMode: "shared", scopes: [], authentication,
      settings: { httpUrl: "https://warehouse.example:8443/query/", ...(authentication.method === "api-key" ? { username: "reader" } : {}) }
    } }, extensions: { fromCli: true } },
    providers: [clickhouseProvider], authorize: async (owner) => owner,
    resolveReference: async (reference) => { resolutions.push(reference); return state.secret; },
    store: createFileConnectionStore({ directory, protection }),
    fetchImpl: async (address, init) => {
      requests.push({ url: new URL(String(address)), init, headers: new Headers(init.headers) });
      return state.text === undefined ? Response.json(state.response, { status: state.status }) : new Response(state.text, { status: state.status });
    }
  };
  return { service: createConnectionService(options), options, directory, protection, requests, resolutions, state };
}

test("ClickHouse verifies Basic credentials without putting them in URLs or files, and resolves rotation after restart", async (t) => {
  const { service, options, directory, protection, requests, resolutions, state } = await fixture(t);
  const connected = await service.connectApiKey(input);
  assert.equal(connected.status, "connected");
  const { url, init, headers } = requests[0];
  assert.equal(url.origin, "https://warehouse.example:8443");
  assert.equal(url.pathname, "/query/");
  assert.equal(headers.get("authorization"), `Basic ${Buffer.from(`reader:${state.secret}`).toString("base64")}`);
  assert.equal(init.redirect, "error");
  assert.equal(init.credentials, "omit");
  assert.equal(headers.has("cookie"), false);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    query: "SELECT 1 AS ok, currentUser() AS user FORMAT JSON", readonly: "1", wait_end_of_query: "1",
    max_execution_time: "10", max_result_rows: "100", max_result_bytes: "5242880", result_overflow_mode: "throw"
  });
  for (const name of await readdir(directory)) {
    const text = await readFile(path.join(directory, name), "utf8");
    assert.equal(text.includes(state.secret), false);
    assert.equal(text.includes(headers.get("authorization")), false);
  }
  assert.equal(JSON.stringify(connected).includes(state.secret), false);
  assert.deepEqual(resolutions, ["env:CLICKHOUSE_PASSWORD"]);
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.status(input), connected);
  assert.equal(requests.length, 1, "status validates the local credential binding without querying the database");
  assert.deepEqual(resolutions, ["env:CLICKHOUSE_PASSWORD", "env:CLICKHOUSE_PASSWORD"]);
  state.secret = "rotated-password";
  await restarted.invoke({ ...input, operation: "connection.check" });
  assert.equal(requests.at(-1).headers.get("authorization"), `Basic ${Buffer.from("reader:rotated-password").toString("base64")}`);
  assert.deepEqual(resolutions, ["env:CLICKHOUSE_PASSWORD", "env:CLICKHOUSE_PASSWORD", "env:CLICKHOUSE_PASSWORD"]);
  await restarted.disconnect(input);
  assert.equal((await service.status(input)).status, "disconnected");
});

test("ClickHouse distinguishes an empty password, a missing explicit binding and requests with no credentials", async (t) => {
  const { options, requests, resolutions, state } = await fixture(t, { method: "api-key" });
  delete options.configuration.integrations.warehouse.settings.username;
  const empty = createConnectionService(options);
  await empty.connectApiKey(input);
  assert.equal(requests[0].headers.get("authorization"), `Basic ${Buffer.from("default:").toString("base64")}`);
  assert.equal(resolutions.length, 0);
  options.configuration.integrations.warehouse.authentication.secretRef = "env:EMPTY_PASSWORD";
  state.secret = "";
  const explicit = createConnectionService(options);
  await explicit.connectApiKey(input);
  assert.equal(requests.at(-1).headers.get("authorization"), requests[0].headers.get("authorization"));
  for (const value of [undefined, null, 12, "password\nheader"]) {
    state.secret = value;
    await assert.rejects(explicit.invoke({ ...input, operation: "connection.check" }), { code: "connector_binding_missing" });
  }
  assert.equal(requests.length, 2, "An invalid explicit binding must never fall back to an empty password.");
  options.configuration.integrations.warehouse.authentication = { method: "none" };
  const noCredentials = createConnectionService(options);
  await noCredentials.connectWithoutCredentials(input);
  await noCredentials.invoke({ ...input, operation: "connection.check" });
  assert.ok(requests.slice(2).every(({ headers, url }) => !headers.has("authorization") && !url.searchParams.has("password") && !url.searchParams.has("user")));
  assert.equal(resolutions.length, 5);
});

test("ClickHouse uses typed SQL parameters for discovery and rows and preserves returned data types", async (t) => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  state.response = { meta: [{ name: "name", type: "String" }], data: [{ database: "reports", name: "orders", engine: "MergeTree" }], rows: 1 };
  await service.invoke({ ...input, operation: "tables.list", input: { database: "a' OR 1=1 --\\N", limit: 100, offset: 50 } });
  let params = requests.at(-1).url.searchParams;
  assert.equal(params.get("query"), "SELECT database, name, engine FROM system.tables WHERE database = {database:String} ORDER BY database, name LIMIT {limit:UInt32} OFFSET {offset:UInt64} FORMAT JSON");
  assert.equal(params.get("param_database"), "a' OR 1=1 --\\\\N", "Escape backslashes for ClickHouse's escaped HTTP parameter format.");
  assert.equal(params.get("param_limit"), "100");
  assert.equal(params.get("param_offset"), "50");
  await service.invoke({ ...input, operation: "tables.list" });
  assert.equal(requests.at(-1).url.searchParams.get("query").includes(" WHERE "), false);
  state.response = { meta: [{ name: "name", type: "String" }], data: [{ name: "total", type: "Decimal(18, 2)", position: "2", default_kind: "", default_expression: "" }], rows: 1 };
  await service.invoke({ ...input, operation: "columns.list", input: { database: "reports", table: "order.items" } });
  assert.equal(requests.at(-1).url.searchParams.get("param_table"), "order.items");
  assert.match(requests.at(-1).url.searchParams.get("query"), /database = \{database:String\} AND table = \{table:String\}/u);
  state.response = { meta: [{ name: "id", type: "UInt64" }], data: [{ id: "18446744073709551615", total: "20.00", extra: null, tags: ["one"] }], rows: 1 };
  const response = await service.invoke({ ...input, operation: "rows.list", input: { database: "db.name", table: "table`name", orderBy: "id; DROP TABLE x" } });
  assert.deepEqual(response, state.response);
  params = requests.at(-1).url.searchParams;
  assert.equal(params.get("query"), "SELECT * FROM {database:Identifier}.{table:Identifier} ORDER BY {orderBy:Identifier} LIMIT {limit:UInt32} OFFSET {offset:UInt64} FORMAT JSON");
  assert.equal(params.get("param_orderBy"), "id; DROP TABLE x");
  assert.equal(params.get("param_database"), "db.name");
  assert.equal(params.get("param_table"), "table`name");
  assert.equal(params.get("param_limit"), "20");
  assert.equal(params.get("param_offset"), "0");
  assert.ok(requests.every(({ init }) => init.method === "GET" && init.body === undefined));
});

test("ClickHouse rejects invalid settings, credential references, SQL and query-setting overrides before HTTP", async (t) => {
  const { service, options, requests } = await fixture(t);
  const parse = (configuration) => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [clickhouseProvider] });
  assert.deepEqual(parse(options.configuration), options.configuration);
  for (const httpUrl of [undefined, "", "http://warehouse.example", "https://user:pass@warehouse.example", "https://warehouse.example?readonly=0", "https://warehouse.example/#fragment", "https://warehouse.example/a/../"]) {
    const configuration = structuredClone(options.configuration);
    configuration.integrations.warehouse.settings.httpUrl = httpUrl;
    assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors["integrations.warehouse.settings.httpUrl"]));
  }
  for (const username of ["", "user:password", "bad\nuser"]) {
    const configuration = structuredClone(options.configuration);
    configuration.integrations.warehouse.settings.username = username;
    assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors["integrations.warehouse.settings.username"]));
  }
  const configuration = structuredClone(options.configuration);
  configuration.integrations.warehouse.authentication.secretRef = "raw-password";
  assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors["integrations.warehouse.authentication.secretRef"]));
  await service.connectApiKey(input);
  for (const value of [{}, { database: "reports" }, { database: "", table: "x" }, { database: "x", table: "bad\tname" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "rows.list", input: value }), { code: "connector_input_invalid" });
  }
  for (const value of [{ limit: 101 }, { limit: 0 }, { limit: 1.5 }, { offset: -1 }, { offset: 1000001 }, { query: "DROP TABLE x" }, { readonly: 0 }, { url: "https://other.example" }, { max_execution_time: 0 }, { settings: {} }]) {
    await assert.rejects(service.invoke({ ...input, operation: "tables.list", input: value }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, 1);
});

test("ClickHouse accepts empty results and rejects partial or error results, including HTTP-200 exceptions", async (t) => {
  const { service, requests, state } = await fixture(t);
  state.response = { meta: [], data: [], rows: 0 };
  await assert.rejects(service.connectApiKey(input), { code: "connector_response_invalid" });
  assert.equal((await service.status(input)).status, "disconnected");
  state.response = checked;
  await service.connectApiKey(input);
  for (const operation of ["tables.list", "columns.list", "rows.list"]) {
    state.response = { meta: [], data: [], rows: 0 };
    const fields = operation === "tables.list" ? {} : { database: "reports", table: "orders" };
    assert.deepEqual(await service.invoke({ ...input, operation, input: fields }), state.response);
  }
  for (const response of [{}, { meta: [], data: [{}], rows: 0 }, { meta: [{}], data: [], rows: 0 },
    { meta: [], data: [null], rows: 1 }, { meta: [], data: Array(101).fill({}), rows: 101 },
    { meta: [], data: [], rows: 0, exception: state.secret }, { error: state.secret }]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation: "rows.list", input: { database: "reports", table: "orders" } }), { code: "connector_response_invalid" });
  }
  for (const text of ["{\"meta\":[],\"data\":[", `${JSON.stringify(checked)}\nCode: 241. DB::Exception: ${state.secret}`]) {
    state.text = text;
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "connection.check" }), (error) => {
      assert.equal(error.code, "connector_response_invalid");
      assert.equal(error.stack.includes(state.secret), false);
      return true;
    });
    assert.equal(requests.length, count + 1);
  }
});

test("ClickHouse isolates connections and requires verification after changing mode, username or destination", async (t) => {
  const { service, options, requests, resolutions } = await fixture(t);
  await service.connectApiKey(input);
  for (const owner of [{ ...context, applicationId: "other" }, { ...context, subjectId: "other" }]) {
    await assert.rejects(service.invoke({ ...input, context: owner, operation: "connection.check" }), { code: "connector_reconnect_required" });
  }
  for (const changes of [{ username: "other" }, { httpUrl: "https://other.example" }, { httpUrl: "https://warehouse.example:8443/other/" }]) {
    const configuration = structuredClone(options.configuration);
    Object.assign(configuration.integrations.warehouse.settings, changes);
    const changed = createConnectionService({ ...options, configuration });
    assert.equal((await changed.status(input)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...input, operation: "connection.check" }), { code: "connector_reconnect_required" });
  }
  const denied = createConnectionService({ ...options, authorize: async () => { throw new Error("Access denied"); } });
  await assert.rejects(denied.connectApiKey(input), /Access denied/u);
  assert.equal(requests.length, 1);
  assert.equal(resolutions.length, 1);
  const configuration = structuredClone(options.configuration);
  configuration.integrations.warehouse.authentication = { method: "none" };
  delete configuration.integrations.warehouse.settings.username;
  const changed = createConnectionService({ ...options, configuration });
  await assert.rejects(changed.invoke({ ...input, operation: "connection.check" }), { code: "connector_reconnect_required" });
  await changed.connectWithoutCredentials(input);
  assert.equal((await service.status(input)).status, "reconnect-required");
  assert.equal(requests.at(-1).headers.has("authorization"), false);
});

test("ClickHouse keeps provider permission, quota and credential failures observable without claiming table access", async (t) => {
  const { service, requests, state } = await fixture(t);
  for (const [status, code] of [[401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status;
    state.response = { error: state.secret };
    const count = requests.length;
    await assert.rejects(service.connectApiKey(input), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.stack.includes(state.secret), false);
      return true;
    });
    assert.equal((await service.status(input)).status, "disconnected");
    assert.equal(requests.length, count + 1);
  }
  state.status = 200;
  state.response = checked;
  await service.connectApiKey(input);
  state.status = 403;
  await assert.rejects(service.invoke({ ...input, operation: "rows.list", input: { database: "private", table: "orders" } }), { code: "connector_permission_denied" });
  assert.equal((await service.status(input)).status, "connected");
  state.status = 401;
  await assert.rejects(service.invoke({ ...input, operation: "connection.check" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("ClickHouse reports timeout and cancellation without replaying a database query", async (t) => {
  const { service, options } = await fixture(t);
  await service.connectApiKey(input);
  for (const [failure, code] of [["TimeoutError", "connector_provider_timeout"], ["AbortError", "connector_cancelled"]]) {
    let calls = 0;
    const controller = new AbortController();
    const interrupted = createConnectionService({ ...options, fetchImpl: async () => {
      calls++;
      controller.abort(new DOMException("Interrupted", failure));
      throw new Error("Wrapped transport failure");
    } });
    await assert.rejects(interrupted.invoke({ ...input, operation: "connection.check", signal: controller.signal }), { code });
    assert.equal(calls, 1);
  }
});


test("ClickHouse analytical queries keep typed values separate, bounded and authorized in both modes", async t => {
  for (const authentication of [{ method: "api-key", secretRef: "env:CLICKHOUSE_PASSWORD" }, { method: "none" }]) {
    const { service, options, state, requests } = await fixture(t, authentication);
    if (authentication.method === "none") await service.connectWithoutCredentials(input); else await service.connectApiKey(input);
    const sql = "SELECT toStartOfMonth(booked_at) AS month, count() AS bookings FROM {db:Identifier}.{table:Identifier} WHERE tenant = {tenant:String} GROUP BY month ORDER BY month LIMIT 100";
    const values = { sql, parameters: { db: "reports", table: "bookings", tenant: "O'Reilly\\shop" } };
    state.response = { meta: [{ name: "bookings", type: "UInt64" }], data: [{ bookings: "9007199254740993" }], rows: 1, statistics: { rows_read: 10000 } };
    assert.deepEqual(await service.invoke({ ...input, operation: "queries.read", input: values }), state.response);
    const request = requests.at(-1);
    assert.equal(request.init.method, "GET"); assert.equal(request.url.searchParams.get("query"), `${sql} FORMAT JSON`);
    assert.equal(request.url.searchParams.get("param_tenant"), values.parameters.tenant.replaceAll("\\", "\\\\"));
    assert.equal(request.url.searchParams.get("readonly"), "1"); assert.equal(request.url.searchParams.get("max_result_rows"), "100");
    assert.equal(request.url.searchParams.has("param_sql"), false); assert.equal(request.headers.has("authorization"), authentication.method === "api-key");
    const count = requests.length;
    for (const invalid of [{ sql: "DROP TABLE bookings" }, { sql: "SELECT 1; SELECT 2" }, { sql: "SELECT 1", readonly: 0 },
      { sql: "SELECT {x:Int32}", parameters: { x: 3 } }, { sql: "SELECT 1", parameters: { "a&readonly": "0" } }])
      await assert.rejects(service.invoke({ ...input, operation: "queries.read", input: invalid }), { code: "connector_input_invalid" });
    const denied = createConnectionService({ ...options, authorize: async (owner, request) => request.operation === "queries.read" ? null : owner });
    await assert.rejects(denied.invoke({ ...input, operation: "queries.read", input: values }), { code: "connector_access_denied" });
    assert.equal(requests.length, count);
    state.status = 500; state.response = { error: "query setting forbidden" };
    await assert.rejects(service.invoke({ ...input, operation: "queries.read", input: values }), { code: "connector_provider_failed" });
    assert.equal(requests.length, count + 1);
    state.status = 200; state.response = { meta: [], data: [], rows: 0, exception: "query interrupted" };
    await assert.rejects(service.invoke({ ...input, operation: "queries.read", input: values }), { code: "connector_response_invalid" });
  }
});
