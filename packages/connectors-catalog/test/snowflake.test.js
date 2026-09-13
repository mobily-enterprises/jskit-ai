import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { getProviderScopes, parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { snowflakeProvider } from "../src/server/snowflake.js";

const context = { applicationId: "app-one", subjectId: "owner-one" };
const args = { context, integrationId: "warehouse" };
const callback = "https://app.example.test/oauth/snowflake/callback";
const database = { name: "INVENTORY", owner: "VIBE64_READER", kind: "PERMANENT", comment: "Stock", created_on: "2026-09-01T12:00:00Z" };
async function fixture(t, { role = "VIBE64_READER", accountUrl = "https://myorg-myaccount.snowflakecomputing.com", basic = false, sqlContext = {} } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "snowflake-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = { accountUrl, ...(role ? { role } : {}), ...sqlContext };
  const scopes = getProviderScopes(snowflakeProvider, settings).map((scope) => scope.value);
  const configuration = { schemaVersion: 1, registrations: { snowflake: { source: "own", clientId: "fixture+client/id",
    clientSecretRef: "env:SNOWFLAKE_SECRET", callbackUrlRef: "env:SNOWFLAKE_CALLBACK", ...(basic ? { tokenEndpointAuthMethod: "client_secret_basic" } : {}) } }, integrations: {
    warehouse: { provider: "snowflake", accountMode: "per-user", settings, scopes,
      authentication: { method: "oauth2", registrationRef: "snowflake" } }
  } };
  const state = { time: Date.now(), count: 0, value: undefined, status: 200, tokenPatch: {}, tokenStatus: 200, hang: false, secret: "private+secret/=" };
  const requests = [];
  const options = { configuration, providers: [{ ...snowflakeProvider, requestTimeoutMs: 50 }], authorize: async (owner) => owner,
    now: () => state.time, resolveReference: async (reference) => {
      if (reference === "env:SNOWFLAKE_SECRET") return state.secret;
      assert.equal(reference, "env:SNOWFLAKE_CALLBACK"); return callback;
    },
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(6) }, activeKeyId: "current" }) }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)); requests.push({ url, init });
      assert.equal(url.origin, new URL(accountUrl).origin);
      const headers = new Headers(init.headers);
      if (url.pathname === "/oauth/token-request") {
        assert.equal(init.method, "POST"); const body = new URLSearchParams(init.body);
        if (basic) {
          const auth = headers.get("authorization"); assert.equal(auth.split(" ")[0], "Basic");
          assert.deepEqual(Buffer.from(auth.split(" ")[1], "base64").toString().split(":").map(decodeURIComponent), ["fixture+client/id", state.secret]);
          assert.equal(body.has("client_secret"), false); assert.equal(body.has("client_id"), false);
        } else {
          assert.equal(body.get("client_id"), "fixture+client/id"); assert.equal(body.get("client_secret"), state.secret);
          assert.equal(headers.has("authorization"), false);
        }
        if (body.get("grant_type") === "authorization_code") {
          assert.equal(body.get("redirect_uri"), callback); assert.equal(body.get("code"), "private-code"); assert.ok(body.get("code_verifier"));
        } else {
          assert.equal(body.get("grant_type"), "refresh_token"); assert.equal(body.get("refresh_token"), `private-refresh-${state.count}`);
        }
        state.count++;
        return Response.json(state.tokenStatus === 200 ? { access_token: `private-access-${state.count}`, token_type: "Bearer", expires_in: 120,
          refresh_token: `private-refresh-${state.count}`, ...state.tokenPatch }
          : { error: "invalid_grant", message: "private-provider-error", success: false }, { status: state.tokenStatus });
      }
      if (state.sqlReply && url.pathname.startsWith("/api/v2/statements")) return state.sqlReply(url, init);
      assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
      assert.equal(headers.get("authorization"), `Bearer private-access-${state.count}`);
      assert.equal(headers.get("x-snowflake-authorization-token-type"), "OAUTH");
      assert.equal(headers.get("x-snowflake-role"), role ? `"${role}"` : null);
      assert.equal(url.pathname, "/api/v2/databases");
      if (state.hang) return new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Missing abort")), 1000);
        const abort = () => { clearTimeout(timer); reject(init.signal.reason); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
      });
      if (state.status === 204) return new Response(null, { status: 204 });
      if (typeof state.value === "string") return new Response(state.value, { status: state.status });
      return Response.json(state.value === undefined ? [database] : state.value, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  const start = async () => {
    const { authorizationUrl } = await service.beginAuthorization({ ...args, verificationInput: { showLimit: 1 } });
    const url = new URL(authorizationUrl); const returned = new URL(callback);
    returned.searchParams.set("state", url.searchParams.get("state")); returned.searchParams.set("code", "private-code"); returned.searchParams.set("scope", url.searchParams.get("scope"));
    return { url, callbackUrl: returned.href };
  };
  const connect = async () => service.completeAuthorization({ ...args, callbackUrl: (await start()).callbackUrl });
  return { directory, service, state, options, requests, start, connect };
}

test("Snowflake binds PKCE and credentials to the account and persists encrypted restartable consent", async (t) => {
  const f = await fixture(t); const start = await f.start();
  assert.equal(start.url.href.split("?")[0], "https://myorg-myaccount.snowflakecomputing.com/oauth/authorize");
  assert.equal(start.url.searchParams.get("scope"), "refresh_token session:role:VIBE64_READER");
  assert.equal(start.url.searchParams.get("code_challenge_method"), "S256"); assert.equal(start.url.searchParams.has("client_secret"), false);
  await f.service.completeAuthorization({ ...args, callbackUrl: start.callbackUrl });
  for (const file of await readdir(f.directory)) {
    const value = await readFile(path.join(f.directory, file), "utf8");
    for (const secret of ["private-code", "private+secret/=", "private-access-1", "private-refresh-1"]) assert.equal(value.includes(secret), false);
  }
  const restarted = createConnectionService(f.options);
  assert.equal((await restarted.status(args)).status, "connected");
  assert.deepEqual((await restarted.status(args)).grantedScopes, ["refresh_token", "session:role:VIBE64_READER"]);
  assert.deepEqual(await restarted.invoke({ ...args, operation: "databases.list" }), [database]);
});

test("Snowflake supports optional default roles, encoded case-sensitive roles, Basic auth and account URL forms", async (t) => {
  for (const setting of [{ role: "", accountUrl: "https://myorg-my_account.snowflakecomputing.com/" },
    { role: "Inventory & stock", basic: true, accountUrl: "https://xy123.eu-west-1.aws.snowflakecomputing.com" },
    { role: "PUBLIC", accountUrl: "https://myorg-myaccount.privatelink.snowflakecomputing.com" }]) {
    const f = await fixture(t, setting); const start = await f.start();
    assert.equal(start.url.searchParams.get("scope"), setting.role === "" ? "refresh_token" : setting.role === "PUBLIC" ? "refresh_token session:role:PUBLIC"
      : "refresh_token session:role-encoded:Inventory%20%26%20stock");
    await f.service.completeAuthorization({ ...args, callbackUrl: start.callbackUrl });
  }
});

test("Snowflake returns bounded filtered pages and empty accounts without following supplied continuation URLs", async (t) => {
  const f = await fixture(t); await f.connect();
  await f.service.invoke({ ...args, operation: "databases.list", input: { showLimit: 3, like: "WARE%", startsWith: "WARE", fromName: "WARE A&B", history: true } });
  assert.equal(f.requests.at(-1).url.search, "?showLimit=3&like=WARE%25&startsWith=WARE&fromName=WARE+A%26B&history=true");
  f.state.value = []; assert.deepEqual(await f.service.invoke({ ...args, operation: "databases.list", input: { fromName: "INVENTORY" } }), []);
  assert.equal(f.requests.length, 4);
});

test("Snowflake rejects oversized, unsupported and mutating operation input before transport", async (t) => {
  const f = await fixture(t); await f.connect(); const before = f.requests.length;
  for (const input of [{ showLimit: 0 }, { showLimit: 1001 }, { showLimit: 1.5 }, { history: "wrong" }, { fromName: "" },
    { fromName: "x".repeat(256) }, { like: "" }, { accountUrl: "https://other.test" }, { url: "https://other.test" }, { role: "ACCOUNTADMIN" }, { statement: "SELECT 1" }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "databases.list", input }), { code: "connector_input_invalid" });
  }
  for (const operation of ["databases.create", "databases.delete", "sql.execute"]) await assert.rejects(f.service.invoke({ ...args, operation }), { code: "connector_operation_unknown" });
  assert.equal(f.requests.length, before);
});

test("Snowflake isolates application users and invalidates saved grants after account or role edits", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const owner of [{ ...context, subjectId: "another" }, { ...context, applicationId: "another" }]) {
    await assert.rejects(f.service.invoke({ ...args, context: owner, operation: "databases.list" }), { code: "connector_reconnect_required" });
  }
  const denied = createConnectionService({ ...f.options, authorize: async () => null });
  await assert.rejects(denied.invoke({ ...args, operation: "databases.list" }), { code: "connector_access_denied" });
  for (const settings of [{ accountUrl: "https://other-account.snowflakecomputing.com", role: "VIBE64_READER" }, { accountUrl: "https://myorg-myaccount.snowflakecomputing.com", role: "PUBLIC" }]) {
    const configuration = structuredClone(f.options.configuration); configuration.integrations.warehouse.settings = settings;
    configuration.integrations.warehouse.scopes = getProviderScopes(snowflakeProvider, settings).map((scope) => scope.value);
    const changed = createConnectionService({ ...f.options, configuration });
    assert.equal((await changed.status(args)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...args, operation: "databases.list" }), { code: "connector_reconnect_required" });
  }
  assert.equal(f.requests.length, 2);
});

test("Snowflake saves rotated refresh tokens before a failed read and marks revoked tokens for reconnection", async (t) => {
  const f = await fixture(t, { basic: true }); await f.connect(); f.state.time += 121_000; f.state.status = 429; f.state.secret = "rotated+secret/=";
  await assert.rejects(f.service.invoke({ ...args, operation: "databases.list" }), { code: "connector_rate_limited" });
  f.state.status = 200; const restarted = createConnectionService(f.options);
  await restarted.invoke({ ...args, operation: "databases.list" }); assert.equal(f.state.count, 2);
  f.state.time += 121_000; f.state.tokenStatus = 400;
  await assert.rejects(restarted.invoke({ ...args, operation: "databases.list" }), (error) => error.code === "connector_reconnect_required" && !error.message.includes("private"));
  assert.equal((await restarted.status(args)).status, "reconnect-required");
});

test("Snowflake accepts short-lived consent without refresh and rejects malformed grants and ambiguous callback scopes", async (t) => {
  const short = await fixture(t); short.state.tokenPatch.refresh_token = undefined; await short.connect(); short.state.time += 121_000;
  await assert.rejects(short.service.invoke({ ...args, operation: "databases.list" }), { code: "connector_reconnect_required" });
  assert.equal(short.requests.length, 2);
  for (const tokenPatch of [{ expires_in: undefined }, { expires_in: 0 }, { expires_in: 1.5 }, { scope: "" }, { scope: "refresh_token\nadmin" }, { refresh_token: "" }]) {
    const f = await fixture(t); f.state.tokenPatch = tokenPatch;
    await assert.rejects(f.connect(), { code: "connector_response_invalid" }); assert.equal(f.requests.length, 1);
  }
  for (const duplicate of [false, true]) {
    const f = await fixture(t); const start = await f.start(); const url = new URL(start.callbackUrl);
    if (duplicate) url.searchParams.append("scope", "refresh_token"); else url.searchParams.delete("scope");
    await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: url.href }), { code: "connector_response_invalid" }); assert.equal(f.requests.length, 0);
  }
});

test("Snowflake consumes denied, cancelled, mismatched and replayed attempts while preserving earlier access", async (t) => {
  const f = await fixture(t); await f.connect(); const start = await f.start();
  const configuration = structuredClone(f.options.configuration); configuration.integrations.warehouse.settings.accountUrl = "https://other-account.snowflakecomputing.com";
  const other = createConnectionService({ ...f.options, configuration });
  await assert.rejects(other.completeAuthorization({ ...args, callbackUrl: start.callbackUrl }), { code: "connector_attempt_invalid" });
  const denied = await f.start(); const returned = new URL(denied.callbackUrl); returned.searchParams.delete("code"); returned.searchParams.set("error", "access_denied");
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: returned.href }), { code: "connector_consent_denied" });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: denied.callbackUrl }), { code: "connector_attempt_invalid" });
  const cancelled = await f.start(); await f.service.cancelAuthorization({ ...args, state: cancelled.url.searchParams.get("state") });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: cancelled.callbackUrl }), { code: "connector_attempt_invalid" });
  assert.equal((await f.service.status(args)).status, "connected"); assert.equal(f.requests.length, 2);
});

test("Snowflake rejects malformed, over-limit and asynchronous pages and sanitizes provider failures", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const value of [null, {}, { code: "390303", message: "private-error" }, [null], [{}], [{ name: "" }], [{ name: 4 }], [{ name: "ok", owner: 1 }], "<html>error</html>", [database, database]]) {
    f.state.value = value; await assert.rejects(f.service.invoke({ ...args, operation: "databases.list", input: { showLimit: 1 } }), { code: "connector_response_invalid" });
  }
  for (const status of [202, 204]) { f.state.status = status; f.state.value = []; await assert.rejects(f.service.invoke({ ...args, operation: "databases.list" }), { code: "connector_response_invalid" }); }
  for (const [status, code] of [[403, "connector_permission_denied"], [500, "connector_provider_failed"], [429, "connector_rate_limited"], [401, "connector_reconnect_required"]]) {
    f.state.status = status; f.state.value = { message: "private-provider-error" };
    await assert.rejects(f.service.invoke({ ...args, operation: "databases.list" }), (error) => error.code === code && !error.message.includes("private"));
  }
});

test("Snowflake bounds cancellation and timeout and disconnects locally", async (t) => {
  const f = await fixture(t); await f.connect(); f.state.hang = true;
  const controller = new AbortController(); const pending = f.service.invoke({ ...args, operation: "databases.list", signal: controller.signal });
  setTimeout(() => controller.abort(), 10); await assert.rejects(pending, { code: "connector_cancelled" });
  await assert.rejects(f.service.invoke({ ...args, operation: "databases.list" }), { code: "connector_provider_timeout" });
  await f.service.disconnect(args); assert.equal((await f.service.status(args)).status, "disconnected"); assert.equal(f.requests.length, 4);
});

test("Snowflake guide JSON, CLI validation and dynamic form permissions describe the same configuration", async () => {
  const guide = await readFile(new URL("../docs/snowflake.md", import.meta.url), "utf8");
  const config = JSON.parse([...guide.matchAll(/```json\n([\s\S]*?)\n```/gu)][0][1]);
  const parse = (value) => parseIntegrationConfiguration(JSON.stringify(value), { providers: [snowflakeProvider] });
  assert.deepEqual(parse(config), config);
  for (const accountUrl of ["", "http://myorg-account.snowflakecomputing.com", "https://app.snowflake.com/org/account", "https://myorg-account.snowflakecomputing.com.attacker.test",
    "https://myorg-account.snowflakecomputing.com/path", "https://myorg-account.snowflakecomputing.com/?o=1", "https://myorg-account.snowflakecomputing.com/#page",
    "https://user@myorg-account.snowflakecomputing.com", "https://myorg-account.snowflakecomputing.com:8443", "https://myorg-account.snowflakecomputing.com/../", "https://127.0.0.1"]) {
    const invalid = structuredClone(config); invalid.integrations.warehouse.settings.accountUrl = accountUrl;
    assert.throws(() => parse(invalid), (error) => Boolean(error.fieldErrors["integrations.warehouse.settings.accountUrl"]));
  }
  for (const role of ["ACCOUNTADMIN", "SECURITYADMIN", "ORGADMIN", "GLOBALORGADMIN", "admin\nreader", '"READER"', "a\\b", "équipe", "x".repeat(256)]) {
    const invalid = structuredClone(config); invalid.integrations.warehouse.settings.role = role;
    assert.throws(() => parse(invalid), (error) => Boolean(error.fieldErrors["integrations.warehouse.settings.role"]));
  }
  const stale = structuredClone(config); stale.integrations.warehouse.settings.role = "PUBLIC";
  assert.throws(() => parse(stale), (error) => Boolean(error.fieldErrors["integrations.warehouse.scopes"]));
  const defaults = structuredClone(config); delete defaults.integrations.warehouse.settings.role; defaults.integrations.warehouse.scopes = ["refresh_token"];
  assert.deepEqual(parse(defaults), defaults);
  for (const [key, value] of [["callbackUrlRef", callback], ["clientSecretRef", "raw-secret"], ["tokenEndpointAuthMethod", "none"], ["grantType", "client_credentials"]]) {
    const invalid = structuredClone(config); invalid.registrations.snowflake[key] = value;
    assert.throws(() => parse(invalid), (error) => Boolean(error.fieldErrors[`registrations.snowflake.${key}`]));
  }
});


test("Snowflake retains exact SQL context names in portable configuration", async (t) => {
  const { options } = await fixture(t);
  options.configuration.integrations.warehouse.settings = { ...options.configuration.integrations.warehouse.settings,
    warehouse: "AppCompute", database: "AppData", schema: "Reporting" };
  const configuration = parseIntegrationConfiguration(JSON.stringify(options.configuration), { providers: [snowflakeProvider] });
  assert.equal(configuration.integrations.warehouse.settings.warehouse, "AppCompute");
  assert.equal(configuration.integrations.warehouse.settings.database, "AppData");
  assert.equal(configuration.integrations.warehouse.settings.schema, "Reporting");
});


test("Snowflake SQL lifecycle binds context, preserves typed partitions and cancels explicitly", async (t) => {
  const { service: runtime, state, requests, connect } = await fixture(t, { sqlContext: { warehouse: "APP_WH", database: "DATA", schema: "PUBLIC" } });
  await connect();
  const handle = "019c07a7-0000-df4f-0000-001000067872";
  const requestId = "536fad38-b564-4dc5-9892-a4543504df6c";
  let phase = 0;
  state.sqlReply = (url, init) => {
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer private-access-1");
    assert.equal(new Headers(init.headers).get("x-snowflake-role"), '\"VIBE64_READER\"');
    assert.equal(init.redirect, "error");
    if (phase++ === 0) {
      assert.equal(init.method, "POST");
      assert.equal(url.searchParams.get("requestId"), requestId);
      assert.equal(url.searchParams.get("async"), "true");
      assert.deepEqual(JSON.parse(init.body), { statement: "select ?", bindings: { "1": { type: "FIXED", value: "9007199254740993" } }, timeout: 60,
        warehouse: "APP_WH", database: "DATA", schema: "PUBLIC", role: "VIBE64_READER", parameters: { multi_statement_count: "1" } });
      return Response.json({ code: "333334", statementHandle: handle, statementStatusUrl: "https://untrusted.test/never-follow" }, { status: 202 });
    }
    assert.equal(url.pathname, `/api/v2/statements/${handle}${phase === 4 ? "/cancel" : ""}`);
    if (phase === 2) return Response.json({ code: "090001", statementHandle: handle,
      resultSetMetaData: { rowType: [{ name: "COUNT", type: "fixed", scale: 0 }], partitionInfo: [{ rowCount: 1 }, { rowCount: 1 }] }, data: [["9007199254740993"]] });
    if (phase === 3) {
      assert.equal(url.searchParams.get("partition"), "1");
      return Response.json({ data: [[null]] });
    }
    assert.equal(init.method, "POST");
    return Response.json({ code: "000604", statementHandle: handle });
  };
  const pending = await runtime.invoke({ ...args, operation: "statements.submit", input: { statement: "select ?", requestId, bindings: { "1": { type: "FIXED", value: "9007199254740993" } } } });
  assert.deepEqual(pending, { status: "pending", handle });
  const result = await runtime.invoke({ ...args, operation: "statements.get", input: { handle } });
  assert.equal(result.data[0][0], "9007199254740993"); assert.equal(result.metadata.rowType[0].type, "fixed");
  assert.deepEqual((await runtime.invoke({ ...args, operation: "statements.get", input: { handle, partition: 1 } })).data, [[null]]);
  assert.equal((await runtime.invoke({ ...args, operation: "statements.cancel", input: { handle } })).status, "cancelled");
  const before = requests.length;
  await assert.rejects(runtime.invoke({ ...args, operation: "statements.get", input: { handle: "../../other" } }));
  await assert.rejects(runtime.invoke({ ...args, operation: "statements.submit", input: { statement: "select ?", requestId, bindings: { "1": { type: "FIXED", value: 9007199254740992 } } } }));
  assert.equal(requests.length, before);
});

test("Snowflake warehouse actions quote exact names and share the asynchronous lifecycle", async (t) => {
  const { service, state, requests, connect } = await fixture(t);
  await connect();
  const requestId = "536fad38-b564-4dc5-9892-a4543504df6c";
  const handle = "019c07a7-0000-df4f-0000-001000067872";
  const name = 'App"; DROP DATABASE X; --';
  const quoted = '"App""; DROP DATABASE X; --"';
  for (const [action, suffix] of [
    ["create", `CREATE WAREHOUSE ${quoted} WAREHOUSE_SIZE = XSMALL INITIALLY_SUSPENDED = TRUE AUTO_SUSPEND = 60 AUTO_RESUME = FALSE`],
    ["resize", `ALTER WAREHOUSE ${quoted} SET WAREHOUSE_SIZE = XSMALL`],
    ["resume", `ALTER WAREHOUSE ${quoted} RESUME IF SUSPENDED`],
    ["suspend", `ALTER WAREHOUSE ${quoted} SUSPEND`],
    ["delete", `DROP WAREHOUSE ${quoted}`]
  ]) {
    state.sqlReply = (url, init) => {
      assert.equal(JSON.parse(init.body).statement, suffix);
      assert.equal(JSON.parse(init.body).parameters.multi_statement_count, "1");
      assert.equal(url.searchParams.get("requestId"), requestId);
      return Response.json({ code: "333334", statementHandle: handle }, { status: 202 });
    };
    assert.deepEqual(await service.invoke({ ...args, operation: `warehouses.${action}`, input: {
      name, requestId, ...(["create", "resize"].includes(action) ? { size: "XSMALL" } : {})
    } }), { status: "pending", handle });
  }
  const before = requests.length;
  await assert.rejects(service.invoke({ ...args, operation: "warehouses.resize", input: { name, requestId, size: "SMALL; SELECT 1" } }));
  assert.equal(requests.length, before);
});

test("Snowflake stops oversized SQL response streams before parsing", async (t) => {
  const { service, state, connect } = await fixture(t);
  await connect();
  let cancelled = false;
  let chunks = 0;
  state.sqlReply = () => new Response(new ReadableStream({
    pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; }
  }));
  await assert.rejects(service.invoke({ ...args, operation: "statements.get", input: {
    handle: "019c07a7-0000-df4f-0000-001000067872"
  } }), { code: "connector_response_too_large" });
  assert.equal(cancelled, true);
  assert.ok(chunks <= 18);
});

test("Snowflake application policy gates SQL, handles and warehouse resources before transport", async (t) => {
  const f = await fixture(t);
  await f.connect();
  const handle = "019c07a7-0000-df4f-0000-001000067872";
  const deniedHandle = "536fad38-b564-4dc5-9892-a4543504df6c";
  const seen = [];
  const service = createConnectionService({ ...f.options, authorize: async (owner, request) => {
    seen.push(request);
    if ((request.operation === "statements.submit" && request.input.statement !== "select 1") ||
      (request.operation === "statements.get" && request.input.handle !== handle) ||
      (request.operation.startsWith("warehouses.") && request.input.name !== "APP_WH")) return null;
    return owner;
  } });
  const before = f.requests.length;
  for (const [operation, input] of [
    ["statements.submit", { statement: "select * from other_tenant", requestId: deniedHandle }],
    ["statements.get", { handle: deniedHandle }],
    ["warehouses.delete", { name: "OTHER_WH", requestId: deniedHandle }]
  ]) await assert.rejects(service.invoke({ ...args, operation, input }), { code: "connector_access_denied" });
  assert.equal(f.requests.length, before);
  assert.equal(seen[2].input.name, "OTHER_WH");
  await assert.rejects(service.invoke({ ...args, context: { ...context, subjectId: "another-user" },
    operation: "statements.get", input: { handle } }), { code: "connector_reconnect_required" });
  assert.equal(f.requests.length, before);
  f.state.sqlReply = () => Response.json({ code: "333334", statementHandle: handle }, { status: 202 });
  assert.deepEqual(await service.invoke({ ...args, operation: "statements.submit", input: {
    statement: "select 1", requestId: deniedHandle
  } }), { status: "pending", handle });
  assert.equal(f.requests.length, before + 1);
});

test("Snowflake rejects failed or mismatched SQL results without replaying execution", async (t) => {
  const { service, state, requests, connect } = await fixture(t);
  await connect();
  const handle = "019c07a7-0000-df4f-0000-001000067872";
  const invoke = () => service.invoke({ ...args, operation: "statements.get", input: { handle } });
  for (const [status, code] of [[422, "connector_operation_rejected"], [429, "connector_rate_limited"], [503, "connector_provider_failed"]]) {
    state.sqlReply = () => Response.json({ message: "private SQL and table names", code: "failure" }, { status });
    const before = requests.length;
    await assert.rejects(invoke(), (error) => error.code === code && !error.message.includes("private SQL"));
    assert.equal(requests.length, before + 1);
  }
  const valid = { code: "090001", statementHandle: handle, data: [["1"]], resultSetMetaData: { rowType: [{ name: "VALUE", type: "fixed" }] } };
  for (const value of [
    { ...valid, statementHandle: "536fad38-b564-4dc5-9892-a4543504df6c" },
    { ...valid, data: [[1]] },
    { ...valid, data: [["1", "2"]] },
    { ...valid, resultSetMetaData: undefined },
    { ...valid, code: "failure" }
  ]) {
    state.sqlReply = () => Response.json(value);
    await assert.rejects(invoke(), { code: "connector_response_invalid" });
  }
  state.sqlReply = () => new Response("not JSON", { status: 200 });
  await assert.rejects(invoke(), { code: "connector_response_invalid" });
  state.sqlReply = () => Response.json({ code: "333334", statementHandle: handle }, { status: 202 });
  assert.deepEqual(await invoke(), { status: "pending", handle });
  state.sqlReply = () => { throw new Error("connection lost after possible execution"); };
  const before = requests.length;
  await assert.rejects(service.invoke({ ...args, operation: "statements.submit", input: {
    statement: "insert into audit_log values (?)", bindings: { "1": { type: "TEXT", value: "booking" } },
    requestId: "536fad38-b564-4dc5-9892-a4543504df6c"
  } }), { code: "connector_provider_failed" });
  assert.equal(requests.length, before + 1);
  assert.equal((await service.status(args)).status, "connected");
});
