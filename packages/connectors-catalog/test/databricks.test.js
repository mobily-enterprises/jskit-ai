import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { getProviderScopes, parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { databricksProvider } from "../src/server/databricks.js";

const context = { applicationId: "app-one", subjectId: "owner-one" };
const args = { context, integrationId: "warehouse" };
const callback = "https://app.example.test/oauth/databricks/callback";
const job = { job_id: 123, settings: { name: "Weekly inventory", tasks: [] } };

async function fixture(t, grantType = "authorization_code", workspaceUrl = "https://dbc-abc123.cloud.databricks.com") {
  const directory = await mkdtemp(path.join(tmpdir(), "databricks-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const machine = grantType === "client_credentials";
  const scopes = machine ? ["jobs"] : ["all-apis", "offline_access"];
  const configuration = { schemaVersion: 1, registrations: { databricks: { source: "own", grantType, clientId: "fixture-client",
    clientSecretRef: "env:DATABRICKS_SECRET", tokenEndpointAuthMethod: machine ? "client_secret_basic" : "client_secret_post",
    ...(machine ? {} : { callbackUrlRef: "env:DATABRICKS_CALLBACK" }) } }, integrations: {
    warehouse: { provider: "databricks", accountMode: machine ? "shared" : "per-user", settings: { workspaceUrl }, scopes,
      authentication: { method: "oauth2", registrationRef: "databricks" } }
  } };
  const state = { time: Date.now(), count: 0, value: undefined, status: 200, tokenPatch: {}, tokenStatus: 200, hang: false, secret: "private-client-secret" };
  const requests = [];
  const options = { configuration, providers: [{ ...databricksProvider, requestTimeoutMs: 50 }], authorize: async (owner) => owner,
    now: () => state.time, resolveReference: async (reference) => {
      if (reference === "env:DATABRICKS_SECRET") return state.secret;
      assert.equal(machine, false, "A service account must never request a callback binding.");
      assert.equal(reference, "env:DATABRICKS_CALLBACK");
      return callback;
    },
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(6) }, activeKeyId: "current" }) }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)); requests.push({ url, init });
      assert.equal(url.origin, new URL(workspaceUrl).origin);
      const headers = new Headers(init.headers);
      if (url.pathname === "/oidc/v1/token") {
        assert.equal(init.method, "POST");
        const body = new URLSearchParams(init.body);
        if (machine) {
          assert.equal(body.get("grant_type"), "client_credentials");
          assert.equal(body.get("scope"), scopes.join(" "));
          const auth = headers.get("authorization"); assert.equal(auth.split(" ")[0], "Basic");
          assert.deepEqual(Buffer.from(auth.split(" ")[1], "base64").toString().split(":").map(decodeURIComponent), ["fixture-client", state.secret]);
          for (const key of ["redirect_uri", "code", "code_verifier", "client_secret", "refresh_token"]) assert.equal(body.has(key), false);
        } else {
          assert.equal(body.get("client_id"), "fixture-client"); assert.equal(body.get("client_secret"), state.secret);
          if (body.get("grant_type") === "authorization_code") {
            assert.equal(body.get("redirect_uri"), callback); assert.equal(body.get("code"), "private-code"); assert.ok(body.get("code_verifier"));
          } else {
            assert.equal(body.get("grant_type"), "refresh_token"); assert.equal(body.get("refresh_token"), `private-refresh-${state.count}`);
          }
        }
        state.count++;
        return Response.json(state.tokenStatus === 200 ? { access_token: `private-access-${state.count}`, token_type: "Bearer", expires_in: 120,
          ...(machine ? {} : { refresh_token: `private-refresh-${state.count}`, scope: scopes.join(" ") }), ...state.tokenPatch }
          : { error: machine ? "invalid_client" : "invalid_grant", error_description: "private-provider-error" }, { status: state.tokenStatus });
      }
      assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
      assert.equal(headers.get("authorization"), `Bearer private-access-${state.count}`);
      assert.match(url.pathname, /^\/api\/2\.2\/jobs\/(list|get)$/u);
      if (state.hang) return new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Missing abort")), 1000);
        const abort = () => { clearTimeout(timer); reject(init.signal.reason); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
      });
      if (state.status === 204) return new Response(null, { status: 204 });
      if (typeof state.value === "string") return new Response(state.value, { status: state.status });
      return Response.json(state.value === undefined ? url.pathname.endsWith("/get") ? job : { jobs: [job], next_page_token: "page+two=" } : state.value, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  const start = async () => {
    const { authorizationUrl } = await service.beginAuthorization({ ...args, verificationInput: { limit: 1 } });
    const url = new URL(authorizationUrl); const returned = new URL(callback);
    returned.searchParams.set("state", url.searchParams.get("state")); returned.searchParams.set("code", "private-code");
    return { url, callbackUrl: returned.href };
  };
  const connect = async () => machine ? service.connectClientCredentials({ ...args, verificationInput: { limit: 1 } })
    : service.completeAuthorization({ ...args, callbackUrl: (await start()).callbackUrl });
  return { directory, service, state, options, requests, start, connect };
}

test("Databricks user consent pins the workspace, sends PKCE and persists encrypted restartable grants", async (t) => {
  const f = await fixture(t); const start = await f.start();
  assert.equal(start.url.href.split("?")[0], "https://dbc-abc123.cloud.databricks.com/oidc/v1/authorize");
  assert.equal(start.url.searchParams.get("scope"), "all-apis offline_access");
  assert.equal(start.url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(start.url.searchParams.has("client_secret"), false);
  await f.service.completeAuthorization({ ...args, callbackUrl: start.callbackUrl });
  for (const file of await readdir(f.directory)) {
    const text = await readFile(path.join(f.directory, file), "utf8");
    for (const secret of ["private-code", "private-client-secret", "private-access-1", "private-refresh-1"]) assert.equal(text.includes(secret), false);
  }
  const restarted = createConnectionService(f.options);
  assert.equal((await restarted.status(args)).status, "connected");
  assert.deepEqual(await restarted.invoke({ ...args, operation: "jobs.get", input: { job_id: 123 } }), job);
});

test("Databricks service principals use confidential grants on AWS, Azure and GCP without callbacks", async (t) => {
  for (const origin of ["https://dbc-abc123.cloud.databricks.com", "https://adb-123456789.7.azuredatabricks.net", "https://123456789.7.gcp.databricks.com/"]) {
    const f = await fixture(t, "client_credentials", origin); await f.connect();
    const restarted = createConnectionService(f.options);
    assert.equal((await restarted.status(args)).status, "connected");
    assert.deepEqual((await restarted.status(args)).grantedScopes, ["jobs"]);
    f.state.time += 85_000; // 35 seconds remain: refresh before Azure's 30-second refusal boundary.
    f.state.secret = "rotated-client-secret";
    await Promise.all([restarted.invoke({ ...args, operation: "jobs.list" }), restarted.invoke({ ...args, operation: "jobs.list" })]);
    assert.equal(f.state.count, 2);
    for (const file of await readdir(f.directory)) assert.equal((await readFile(path.join(f.directory, file), "utf8")).includes("private-access"), false);
  }
});

test("Databricks returns bounded job pages, empty lists and nested detail continuation without running jobs", async (t) => {
  const f = await fixture(t); await f.connect();
  const before = f.requests.length;
  await f.service.invoke({ ...args, operation: "jobs.list", input: { limit: 2, name: "Inventory & stock", expand_tasks: true, page_token: "page+two=" } });
  assert.equal(f.requests.length, before + 1);
  assert.equal(f.requests.at(-1).url.search, "?limit=2&expand_tasks=true&name=Inventory+%26+stock&page_token=page%2Btwo%3D");
  for (const empty of [{}, { jobs: [] }]) {
    f.state.value = empty; assert.deepEqual(await f.service.invoke({ ...args, operation: "jobs.list" }), empty);
  }
  f.state.value = { ...job, settings: { tasks: [] }, next_page_token: "details+next=" };
  assert.deepEqual(await f.service.invoke({ ...args, operation: "jobs.get", input: { job_id: 123, include_trigger_state: true, page_token: "details+next=" } }), f.state.value);
  assert.equal(f.requests.at(-1).url.search, "?job_id=123&include_trigger_state=true&page_token=details%2Bnext%3D");
});

test("Databricks rejects unsupported input, unsafe numeric identifiers, SQL and writes before transport", async (t) => {
  const f = await fixture(t); await f.connect(); const before = f.requests.length;
  for (const input of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { expand_tasks: "wrong" }, { page_token: "" },
    { page_token: "x".repeat(8193) }, { name: "" }, { workspaceUrl: "https://other.test" }, { url: "https://other.test" }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "jobs.list", input }), { code: "connector_input_invalid" });
  }
  for (const input of [{}, { job_id: 0 }, { job_id: -1 }, { job_id: 1.2 }, { job_id: Number.MAX_SAFE_INTEGER + 1 }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "jobs.get", input }), { code: "connector_input_invalid" });
  }
  for (const operation of ["jobs.run", "jobs.create", "sql.execute"]) await assert.rejects(f.service.invoke({ ...args, operation }), { code: "connector_operation_unknown" });
  assert.equal(f.requests.length, before);
});

test("Databricks verifies granted scopes and application ownership before reading a job", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const owner of [{ ...context, subjectId: "another" }, { ...context, applicationId: "another" }]) {
    await assert.rejects(f.service.invoke({ ...args, context: owner, operation: "jobs.list" }), { code: "connector_reconnect_required" });
  }
  const denied = createConnectionService({ ...f.options, authorize: async () => null });
  await assert.rejects(denied.invoke({ ...args, operation: "jobs.list" }), { code: "connector_access_denied" });
  assert.equal(f.requests.length, 2);
  const insufficient = await fixture(t); insufficient.state.tokenPatch.scope = "offline_access";
  await assert.rejects(insufficient.connect(), { code: "connector_scope_missing" });
  assert.equal(insufficient.requests.length, 1);
  assert.equal((await insufficient.service.status(args)).status, "disconnected");
});

test("Databricks persists renewal before failed reads and marks revoked grants for reconnection in both flows", async (t) => {
  for (const type of ["authorization_code", "client_credentials"]) {
    const f = await fixture(t, type); await f.connect(); f.state.time += 85_000; f.state.status = 429;
    await assert.rejects(f.service.invoke({ ...args, operation: "jobs.list" }), { code: "connector_rate_limited" });
    f.state.status = 200;
    const restarted = createConnectionService(f.options); await restarted.invoke({ ...args, operation: "jobs.list" });
    assert.equal(f.state.count, 2);
    f.state.time += 85_000; f.state.tokenStatus = 400;
    await assert.rejects(restarted.invoke({ ...args, operation: "jobs.list" }), (error) => error.code === "connector_reconnect_required" && !error.message.includes("private"));
    assert.equal((await restarted.status(args)).status, "reconnect-required");
  }
});

test("Databricks rejects malformed token lifetimes, scopes and refresh values before verification", async (t) => {
  for (const tokenPatch of [{ expires_in: undefined }, { expires_in: 40 }, { expires_in: 1.5 }, { scope: "" },
    { scope: "jobs\nall-apis" }, { refresh_token: "" }]) {
    const f = await fixture(t); f.state.tokenPatch = tokenPatch;
    await assert.rejects(f.connect(), { code: "connector_response_invalid" }); assert.equal(f.requests.length, 1);
  }
});

test("Databricks pending consent cannot change workspace and cancelled, denied or replayed consent preserves saved access", async (t) => {
  const f = await fixture(t); await f.connect(); const start = await f.start();
  const changed = structuredClone(f.options.configuration); changed.integrations.warehouse.settings.workspaceUrl = "https://dbc-other.cloud.databricks.com";
  const other = createConnectionService({ ...f.options, configuration: changed });
  await assert.rejects(other.completeAuthorization({ ...args, callbackUrl: start.callbackUrl }), { code: "connector_attempt_invalid" });
  const denied = await f.start(); const returned = new URL(denied.callbackUrl); returned.searchParams.delete("code"); returned.searchParams.set("error", "access_denied");
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: returned.href }), { code: "connector_consent_denied" });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: denied.callbackUrl }), { code: "connector_attempt_invalid" });
  const cancelled = await f.start(); await f.service.cancelAuthorization({ ...args, state: cancelled.url.searchParams.get("state") });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: cancelled.callbackUrl }), { code: "connector_attempt_invalid" });
  assert.equal((await f.service.status(args)).status, "connected"); assert.equal(f.requests.length, 2);
});

test("Databricks grants cannot move to a different workspace, client or service scope without reconnection", async (t) => {
  const f = await fixture(t, "client_credentials"); await f.connect();
  for (const mutate of [(value) => { value.integrations.warehouse.settings.workspaceUrl = "https://dbc-other.cloud.databricks.com"; },
    (value) => { value.registrations.databricks.clientId = "other-client"; }, (value) => { value.integrations.warehouse.scopes = ["all-apis"]; }]) {
    const configuration = structuredClone(f.options.configuration); mutate(configuration);
    const changed = createConnectionService({ ...f.options, configuration });
    assert.equal((await changed.status(args)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...args, operation: "jobs.list" }), { code: "connector_reconnect_required" });
  }
  assert.equal(f.requests.length, 2);
});

test("Databricks rejects malformed job successes, mismatched IDs and overfull pages and redacts provider errors", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const value of [null, [], "not-json", { jobs: null }, { jobs: [{ job_id: 1.5 }] }, { jobs: [{ job_id: Number.MAX_SAFE_INTEGER + 1 }] },
    { jobs: [{ ...job, settings: [] }] }, { jobs: [job, job] }, { error_code: "PRIVATE_ERROR", message: "private-provider-error" },
    { jobs: [], next_page_token: 123 }]) {
    f.state.value = value;
    await assert.rejects(f.service.invoke({ ...args, operation: "jobs.list", input: { limit: 1 } }), (error) =>
      ["connector_response_invalid", "connector_provider_failed"].includes(error.code) && !error.message.includes("private"), JSON.stringify(value));
  }
  f.state.value = { ...job, job_id: 456 };
  await assert.rejects(f.service.invoke({ ...args, operation: "jobs.get", input: { job_id: 123 } }), { code: "connector_response_invalid" });
  f.state.value = undefined; f.state.status = 204;
  await assert.rejects(f.service.invoke({ ...args, operation: "jobs.list" }), { code: "connector_response_invalid" });
  for (const [status, code] of [[403, "connector_permission_denied"], [500, "connector_provider_failed"], [429, "connector_rate_limited"], [401, "connector_reconnect_required"]]) {
    f.state.status = status; f.state.value = { message: "private-provider-error" };
    await assert.rejects(f.service.invoke({ ...args, operation: "jobs.list" }), (error) => error.code === code && !error.message.includes("private"));
  }
});

test("Databricks bounds cancellation and timeout and disconnects locally", async (t) => {
  const f = await fixture(t, "client_credentials"); await f.connect(); f.state.hang = true;
  const controller = new AbortController(); const pending = f.service.invoke({ ...args, operation: "jobs.list", signal: controller.signal });
  setTimeout(() => controller.abort(), 10); await assert.rejects(pending, { code: "connector_cancelled" });
  await assert.rejects(f.service.invoke({ ...args, operation: "jobs.list" }), { code: "connector_provider_timeout" });
  await f.service.disconnect(args); assert.equal((await f.service.status(args)).status, "disconnected"); assert.equal(f.requests.length, 4);
});

test("Databricks guide, CLI parser and shared fields agree on grant-specific inputs and workspace origins", async () => {
  const guide = await readFile(new URL("../docs/databricks.md", import.meta.url), "utf8");
  const blocks = [...guide.matchAll(/```json\n([\s\S]*?)\n```/gu)].map((match) => JSON.parse(match[1]));
  const parse = (value) => parseIntegrationConfiguration(JSON.stringify(value), { providers: [databricksProvider] });
  assert.deepEqual(parse(blocks[0]), blocks[0]);
  const user = structuredClone(blocks[0]); user.registrations["databricks-service"] = blocks[1];
  user.integrations.warehouse.accountMode = "per-user"; user.integrations.warehouse.scopes = ["all-apis", "offline_access"];
  assert.deepEqual(parse(user), user);
  assert.deepEqual(getProviderScopes(databricksProvider).map((scope) => scope.value), ["all-apis", "offline_access"]);
  assert.deepEqual(getProviderScopes(databricksProvider, {}, "client_credentials").map((scope) => scope.value), ["all-apis", "jobs"]);
  for (const workspaceUrl of ["", "http://dbc-abc123.cloud.databricks.com", "https://accounts.cloud.databricks.com", "https://accounts.azuredatabricks.net",
    "https://dbc-abc123.cloud.databricks.com.attacker.test", "https://dbc-abc123.cloud.databricks.com/path", "https://dbc-abc123.cloud.databricks.com/?o=1",
    "https://dbc-abc123.cloud.databricks.com/#page", "https://user@dbc-abc123.cloud.databricks.com", "https://dbc-abc123.cloud.databricks.com:8443",
    "https://dbc-abc123.cloud.databricks.com/../", "https://127.0.0.1", "https://us-east4.gcp.databricks.com"]) {
    const invalid = structuredClone(blocks[0]); invalid.integrations.warehouse.settings.workspaceUrl = workspaceUrl;
    assert.throws(() => parse(invalid), (error) => Boolean(error.fieldErrors["integrations.warehouse.settings.workspaceUrl"]));
  }
  for (const [key, value] of [["callbackUrlRef", callback], ["clientSecretRef", "raw-secret"], ["tokenEndpointAuthMethod", "client_secret_basic"]]) {
    const invalid = structuredClone(user); invalid.registrations["databricks-service"][key] = value;
    assert.throws(() => parse(invalid), (error) => Boolean(error.fieldErrors[`registrations.databricks-service.${key}`]));
  }
});
