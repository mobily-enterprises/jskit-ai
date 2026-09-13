import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { getProviderScopes, parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { microsoftFabricProvider } from "../src/server/microsoft-fabric.js";

const tenantId = "11111111-2222-3333-4444-555555555555";
const clientId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const endpoint = "https://api.fabric.microsoft.com/v1/workspaces/11111111-2222-3333-4444-555555555555/graphqlapis/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/graphql";
const delegated = "https://analysis.windows.net/powerbi/api/GraphQLApi.Execute.All";
const serviceScope = "https://api.fabric.microsoft.com/.default";
const context = { applicationId: "app-one", subjectId: "owner-one" };
const args = { context, integrationId: "fabric" };
const callback = "https://app.example.test/oauth/fabric/callback";
const schema = { __schema: { types: [{ name: "Query", kind: "OBJECT" }], queryType: { name: "Query" }, mutationType: null } };

async function fixture(t, grantType = "authorization_code") {
  const directory = await mkdtemp(path.join(tmpdir(), "fabric-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const machine = grantType === "client_credentials";
  const configuration = { schemaVersion: 1, registrations: { fabric: { source: "own", grantType, clientId,
    clientSecretRef: "env:FABRIC_SECRET", ...(machine ? {} : { callbackUrlRef: "env:FABRIC_CALLBACK" }) } }, integrations: {
    fabric: { provider: "microsoft-fabric", accountMode: machine ? "shared" : "per-user", settings: { tenantId, graphqlEndpoint: endpoint },
      scopes: machine ? [serviceScope] : [delegated, "offline_access"], authentication: { method: "oauth2", registrationRef: "fabric" } }
  } };
  const state = { time: Date.now(), tokenCount: 0, value: undefined, status: 200, tokenPatch: {}, tokenStatus: 200,
    tokenError: machine ? "invalid_client" : "invalid_grant", hang: false, secret: "private-client-secret" };
  const requests = [];
  const options = { configuration, providers: [{ ...microsoftFabricProvider, requestTimeoutMs: 40 }], authorize: async (owner) => owner,
    now: () => state.time, resolveReference: async (reference) => {
      if (reference === "env:FABRIC_SECRET") return state.secret;
      assert.equal(machine, false); assert.equal(reference, "env:FABRIC_CALLBACK"); return callback;
    },
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" }) }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)); requests.push({ url, init });
      assert.equal(init.method, "POST"); const headers = new Headers(init.headers);
      if (url.origin === "https://login.microsoftonline.com") {
        assert.equal(url.pathname, `/${tenantId}/oauth2/v2.0/token`);
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), clientId); assert.equal(body.get("client_secret"), state.secret);
        assert.equal(headers.has("authorization"), false);
        if (machine) {
          assert.equal(body.get("grant_type"), "client_credentials"); assert.equal(body.get("scope"), serviceScope);
          for (const key of ["redirect_uri", "code", "code_verifier", "refresh_token"]) assert.equal(body.has(key), false);
        } else if (body.get("grant_type") === "authorization_code") {
          assert.equal(body.get("redirect_uri"), callback); assert.equal(body.get("code"), "private-code"); assert.ok(body.get("code_verifier"));
        } else {
          assert.equal(body.get("grant_type"), "refresh_token"); assert.equal(body.get("refresh_token"), `private-refresh-${state.tokenCount}`);
        }
        state.tokenCount++;
        return Response.json(state.tokenStatus === 200 ? { access_token: `private-access-${state.tokenCount}`, token_type: "Bearer", expires_in: 120,
          ...(machine ? {} : { refresh_token: `private-refresh-${state.tokenCount}`, scope: "GraphQLApi.Execute.All offline_access" }), ...state.tokenPatch }
          : { error: state.tokenError, error_description: "private-provider-error" }, { status: state.tokenStatus });
      }
      assert.equal(url.href, endpoint); assert.equal(init.redirect, "error");
      assert.equal(headers.get("authorization"), `Bearer private-access-${state.tokenCount}`);
      const body = JSON.parse(init.body); assert.equal(typeof body.query, "string");
      if (state.hang) return new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Missing abort")), 1000);
        const abort = () => { clearTimeout(timer); reject(init.signal.reason); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
      });
      if (state.status === 204) return new Response(null, { status: 204 });
      if (typeof state.value === "string") return new Response(state.value, { status: state.status });
      const data = body.query.includes("ConnectorFabricCheck") ? { __typename: "Query" }
        : body.query.includes("ConnectorFabricTypes") ? schema : { inventory: { items: [], hasNextPage: false, endCursor: null } };
      return Response.json(state.value === undefined ? { data } : state.value, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  const start = async () => {
    const { authorizationUrl } = await service.beginAuthorization(args); const url = new URL(authorizationUrl);
    const returned = new URL(callback); returned.searchParams.set("state", url.searchParams.get("state")); returned.searchParams.set("code", "private-code");
    return { url, callbackUrl: returned.href };
  };
  const connect = async () => machine ? service.connectClientCredentials(args)
    : service.completeAuthorization({ ...args, callbackUrl: (await start()).callbackUrl });
  return { directory, service, state, options, requests, start, connect };
}

test("Fabric user consent pins the tenant, sends PKCE and maps the actual delegated grant", async (t) => {
  const f = await fixture(t); const start = await f.start();
  assert.equal(start.url.href.split("?")[0], `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
  assert.equal(start.url.searchParams.get("scope"), `${delegated} offline_access`);
  assert.equal(start.url.searchParams.get("response_mode"), "query"); assert.equal(start.url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(start.url.searchParams.has("client_secret"), false);
  const metadata = await f.service.completeAuthorization({ ...args, callbackUrl: start.callbackUrl });
  assert.equal(JSON.stringify(metadata).includes("private"), false);
  assert.deepEqual((await f.service.status(args)).grantedScopes, [delegated, "offline_access"]);
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { query: "query ConnectorFabricCheck { __typename }" });
  for (const file of await readdir(f.directory)) {
    const text = await readFile(path.join(f.directory, file), "utf8");
    for (const secret of ["private-code", "private-client-secret", "private-access-1", "private-refresh-1"]) assert.equal(text.includes(secret), false);
  }
  const restarted = createConnectionService(f.options); assert.equal((await restarted.status(args)).status, "connected");
  assert.deepEqual(await restarted.invoke({ ...args, operation: "schema.types" }), { data: schema });
});

test("Fabric service principals use their own resource scope, no callback, and locked credential renewal", async (t) => {
  const f = await fixture(t, "client_credentials"); await f.connect();
  assert.deepEqual((await f.service.status(args)).grantedScopes, [serviceScope]);
  await assert.rejects(f.service.beginAuthorization(args), { code: "connector_mode_unavailable" });
  f.state.time += 95_000; f.state.secret = "rotated-private-secret";
  const restarted = createConnectionService(f.options);
  await Promise.all([restarted.invoke({ ...args, operation: "connection.check" }), restarted.invoke({ ...args, operation: "schema.types" })]);
  assert.equal(f.state.tokenCount, 2);
  assert.equal(JSON.stringify(await restarted.status(args)).includes("private"), false);
});

test("Fabric forwards one explicit document with JSON variables and preserves empty, nullable and paged data", async (t) => {
  const f = await fixture(t); await f.connect(); const before = f.requests.length;
  const input = { query: "query Stock($filter: InventoryFilterInput, $after: String) { inventory(filter: $filter, after: $after, first: 10) { items { id } hasNextPage endCursor } }",
    operationName: "Stock", variables: { filter: { or: [{ id: { eq: 4 } }, { name: { eq: "Stock & supplies" } }] }, after: null } };
  const result = await f.service.invoke({ ...args, operation: "graphql.execute", input });
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), input); assert.equal(f.requests.length, before + 1);
  assert.deepEqual(result.data.inventory.items, []);
  for (const data of [{ inventory: null }, { inventory: { items: [{ id: 4 }], hasNextPage: true, endCursor: "page+two=" } }]) {
    f.state.value = { data }; assert.deepEqual(await f.service.invoke({ ...args, operation: "graphql.execute", input }), { data });
  }
  assert.equal(f.requests.length, before + 3, "No automatic page traversal.");
});

test("Fabric execution is explicitly mutation-capable and application policy can deny the exact document", async (t) => {
  const f = await fixture(t); await f.connect();
  const input = { query: "mutation UpdateStock($id: ID!) { updateStock(id: $id) { id } }", variables: { id: "4" } };
  f.state.value = { data: { updateStock: { id: "4" } } };
  await f.service.invoke({ ...args, operation: "graphql.execute", input });
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), input);
  const before = f.requests.length;
  const denied = createConnectionService({ ...f.options, authorize: async (owner, operation) => {
    if (operation.operation === "graphql.execute") { assert.deepEqual(operation.input, input); return null; }
    return owner;
  } });
  await assert.rejects(denied.invoke({ ...args, operation: "graphql.execute", input }), { code: "connector_access_denied" });
  assert.equal(f.requests.length, before);
});

test("Fabric rejects unsupported inputs and non-JSON variables before transport", async (t) => {
  const f = await fixture(t); await f.connect(); const before = f.requests.length;
  const query = "query Stock { inventory { items { id } } }";
  for (const input of [{}, { query: " " }, { query: "x".repeat(65_537) }, { query, variables: [] },
    { query, variables: { big: "x".repeat(65_537) } }, { query, variables: { count: NaN } },
    { query, variables: { when: new Date() } }, { query, operationName: "two names" }, { query, operationName: "" },
    { query, endpoint: "https://other.test" }, { query, extensions: {} }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "graphql.execute", input }), { code: "connector_input_invalid" });
  }
  for (const operation of ["connection.check", "schema.types"]) await assert.rejects(f.service.invoke({ ...args, operation, input: { query } }), { code: "connector_input_invalid" });
  await assert.rejects(f.service.invoke({ ...args, operation: "graphql.subscribe" }), { code: "connector_operation_unknown" });
  assert.equal(f.requests.length, before);
});

test("Fabric never treats GraphQL errors or malformed payloads as success and never replays mutations", async (t) => {
  const f = await fixture(t); await f.connect();
  const input = { query: "mutation Write { updateStock(id: 4) { id } }" };
  for (const value of [null, [], {}, "not-json", { data: null }, { data: [] }, { data: {}, errors: "wrong" },
    { errors: [{ message: "private-provider-error" }] }, { data: { updateStock: { id: 4 } }, errors: [{ message: "private-provider-error" }] }]) {
    f.state.value = value; const before = f.requests.length;
    await assert.rejects(f.service.invoke({ ...args, operation: "graphql.execute", input }), (error) =>
      ["connector_response_invalid", "connector_provider_failed"].includes(error.code) && !error.message.includes("private"));
    assert.equal(f.requests.length, before + 1);
  }
  f.state.value = { data: {} }; await assert.rejects(f.service.invoke({ ...args, operation: "schema.types" }), { code: "connector_response_invalid" });
  f.state.value = { errors: [{ message: "Introspection disabled" }] };
  await assert.rejects(f.service.invoke({ ...args, operation: "schema.types" }), { code: "connector_provider_failed" });
  assert.equal((await f.service.status(args)).status, "connected");
});

test("Fabric retains renewal before failed calls and requires reconnect after revoked or interactive grants", async (t) => {
  for (const flow of ["authorization_code", "client_credentials"]) {
    const f = await fixture(t, flow); await f.connect(); f.state.time += 95_000; f.state.status = 429;
    await assert.rejects(f.service.invoke({ ...args, operation: "connection.check" }), { code: "connector_rate_limited" });
    f.state.status = 200; const restarted = createConnectionService(f.options);
    await restarted.invoke({ ...args, operation: "connection.check" }); assert.equal(f.state.tokenCount, 2);
    f.state.time += 95_000; f.state.tokenStatus = 400;
    if (flow === "authorization_code") f.state.tokenError = "interaction_required";
    await assert.rejects(restarted.invoke({ ...args, operation: "connection.check" }), { code: "connector_reconnect_required" });
    assert.equal((await restarted.status(args)).status, "reconnect-required");
  }
});

test("Fabric rejects token grants that cannot authorize verification or have invalid expiry", async (t) => {
  for (const tokenPatch of [{ expires_in: undefined }, { expires_in: 30 }, { expires_in: 2.5 }, { scope: "" }, { scope: "GraphQLApi.Execute.All\noffline_access" }]) {
    const f = await fixture(t); f.state.tokenPatch = tokenPatch;
    await assert.rejects(f.connect(), { code: "connector_response_invalid" }); assert.equal(f.requests.length, 1);
  }
  const f = await fixture(t); f.state.tokenPatch.scope = "offline_access";
  await assert.rejects(f.connect(), { code: "connector_scope_missing" }); assert.equal(f.requests.length, 1);
  assert.equal((await f.service.status(args)).status, "disconnected");
});

test("Fabric binds saved grants and pending consent to tenant, endpoint, client, flow and application owner", async (t) => {
  const f = await fixture(t); await f.connect(); const pending = await f.start();
  for (const change of [(config) => { config.integrations.fabric.settings.tenantId = clientId; },
    (config) => { config.integrations.fabric.settings.graphqlEndpoint = endpoint.replace("graphqlapis/aaaaaaaa", "graphqlapis/bbbbbbbb"); },
    (config) => { config.registrations.fabric.clientId = tenantId; }]) {
    const configuration = structuredClone(f.options.configuration); change(configuration);
    const service = createConnectionService({ ...f.options, configuration });
    assert.equal((await service.status(args)).status, "reconnect-required");
    await assert.rejects(service.invoke({ ...args, operation: "connection.check" }), { code: "connector_reconnect_required" });
    await assert.rejects(service.completeAuthorization({ ...args, callbackUrl: pending.callbackUrl }), { code: "connector_attempt_invalid" });
  }
  for (const owner of [{ ...context, subjectId: "other" }, { ...context, applicationId: "other" }]) {
    await assert.rejects(f.service.invoke({ ...args, context: owner, operation: "connection.check" }), { code: "connector_reconnect_required" });
  }
  const machine = await fixture(t, "client_credentials"); await machine.connect();
  const config = structuredClone(machine.options.configuration); config.registrations.fabric.grantType = "authorization_code";
  config.registrations.fabric.callbackUrlRef = "env:FABRIC_CALLBACK"; config.integrations.fabric.scopes = [delegated];
  const changed = createConnectionService({ ...machine.options, configuration: config, resolveReference: async (ref) => ref.endsWith("CALLBACK") ? callback : "private-client-secret" });
  assert.equal((await changed.status(args)).status, "reconnect-required");
});

test("Fabric cancelled or denied consent keeps existing access and consumes the attempt", async (t) => {
  const f = await fixture(t); await f.connect();
  const pending = await f.start(); await f.service.cancelAuthorization({ ...args, state: pending.url.searchParams.get("state") });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: pending.callbackUrl }), { code: "connector_attempt_invalid" });
  const denied = await f.start(); const returned = new URL(denied.callbackUrl); returned.searchParams.delete("code"); returned.searchParams.set("error", "access_denied");
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: returned.href }), { code: "connector_consent_denied" });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: denied.callbackUrl }), { code: "connector_attempt_invalid" });
  assert.equal((await f.service.status(args)).status, "connected"); assert.equal(f.requests.length, 2);
});

test("Fabric aborts hanging requests without replay and local disconnect removes access", async (t) => {
  const f = await fixture(t); await f.connect(); f.state.hang = true;
  const before = f.requests.length; const controller = new AbortController();
  const pending = f.service.invoke({ ...args, operation: "graphql.execute", input: { query: "mutation Write { updateStock(id: 4) { id } }" }, signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, { code: "connector_cancelled" }); assert.equal(f.requests.length, before + 1);
  await assert.rejects(f.service.invoke({ ...args, operation: "connection.check" }), { code: "connector_provider_timeout" });
  assert.equal(f.requests.length, before + 2);
  await f.service.disconnect(args); assert.equal((await f.service.status(args)).status, "disconnected");
});

test("Fabric CLI configuration rejects mixed grants and foreign endpoints and validates both guide examples", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(getProviderScopes(microsoftFabricProvider, {}, "client_credentials").map((scope) => scope.value), [serviceScope]);
  const invalid = (change) => {
    const configuration = structuredClone(f.options.configuration); change(configuration);
    assert.throws(() => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [microsoftFabricProvider] }),
      (error) => error.code === "integration_configuration_invalid" && !error.fieldErrors.configuration);
  };
  for (const tenant of ["common", "organizations", "consumers", "tenant.example.test", "../token"]) invalid((config) => { config.integrations.fabric.settings.tenantId = tenant; });
  for (const url of [endpoint + "?key=private", endpoint + "#fragment", endpoint + "/", endpoint.replace("https:", "http:"),
    endpoint.replace("api.fabric.microsoft.com", "api.fabric.microsoft.com.other.test"), endpoint.replace("/graphql", "/../graphql"),
    endpoint.replace("api.fabric", "user@api.fabric"), endpoint.replace("/v1/", ":444/v1/")]) invalid((config) => { config.integrations.fabric.settings.graphqlEndpoint = url; });
  invalid((config) => { config.integrations.fabric.scopes = [serviceScope]; });
  invalid((config) => { config.registrations.fabric.clientSecretRef = "raw-secret"; });
  invalid((config) => { config.registrations.fabric.clientId = "not-a-guid"; });
  invalid((config) => { config.registrations.fabric.grantType = "client_credentials"; config.integrations.fabric.scopes = [serviceScope]; });
  invalid((config) => { config.registrations.fabric.tokenEndpointAuthMethod = "none"; });
  const guide = await readFile(new URL("../docs/microsoft-fabric.md", import.meta.url), "utf8");
  const blocks = [...guide.matchAll(/```json\n([\s\S]*?)\n```/gu)]; assert.equal(blocks.length, 2);
  for (const block of blocks) assert.deepEqual(parseIntegrationConfiguration(block[1], { providers: [microsoftFabricProvider] }), JSON.parse(block[1]));
});
