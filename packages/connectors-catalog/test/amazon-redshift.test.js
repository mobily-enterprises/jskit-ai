import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration, getProviderSettingsSchema } from "../../connectors-core/src/shared/configuration.js";
import { connectorDefinitions } from "../src/shared/definitions.js";
import { amazonRedshiftProvider as provider } from "../src/server/amazon-redshift.js";

const context = { applicationId: "reports", subjectId: "owner" };
const input = { context, integrationId: "warehouse" };
const statementId = "12345678-1234-1234-1234-123456789abc";
const columns = [{ name: "id", typeName: "int8" }];
const table = { name: "sales", schema: "public", type: "TABLE" };

async function fixture(t, deploymentType = "serverless", databaseUser) {
  const directory = await mkdtemp(path.join(tmpdir(), "redshift-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(6) }, activeKeyId: "current" });
  const requests = [], resolutions = [];
  const target = { Database: "dev", ...(deploymentType === "serverless" ? { WorkgroupName: "analytics" } : { ClusterIdentifier: "analytics-cluster", DbUser: databaseUser || "IAM:reader" }) };
  const state = { key: "AKIAEXAMPLEKEY1234567", secret: "not-live-redshift-secret", session: undefined, status: 200, response: undefined,
    statement: { ...target, Id: statementId, Status: "FINISHED", HasResultSet: true },
    started: { ...target, Id: statementId }, results: { ColumnMetadata: columns, Records: [[{ longValue: 7 }]], TotalNumRows: 1, NextToken: "opaque +/=" } };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { warehouse: {
      provider: provider.id, displayName: "Warehouse", accountMode: "shared", scopes: [],
      authentication: { method: "api-key", secretRef: "env:AWS_SECRET_ACCESS_KEY" },
      settings: { deploymentType, region: "us-east-1", accessKeyIdRef: "env:AWS_ACCESS_KEY_ID", database: "dev",
        ...(deploymentType === "serverless" ? { workgroup: "analytics" } : { clusterIdentifier: "analytics-cluster", ...(databaseUser ? { databaseUser } : {}) }) }
    } }, extensions: { fromCli: true } },
    providers: [provider], authorize: async (owner) => owner,
    resolveReference: async (ref) => { resolutions.push(ref); return { "env:AWS_ACCESS_KEY_ID": state.key, "env:AWS_SECRET_ACCESS_KEY": state.secret, "env:AWS_SESSION_TOKEN": state.session }[ref]; },
    store: createFileConnectionStore({ directory, protection }),
    fetchImpl: async (address, init) => {
      const headers = new Headers(init.headers), action = headers.get("x-amz-target").split(".").at(-1);
      requests.push({ url: new URL(address), init, headers, action, body: JSON.parse(init.body) });
      return Response.json(state.response ?? { ListTables: { Tables: [table] }, DescribeTable: { ColumnList: columns, TableName: "sales" },
        ExecuteStatement: state.started, DescribeStatement: state.statement, GetStatementResult: state.results, CancelStatement: { Status: true } }[action], { status: state.status });
    }
  };
  return { service: createConnectionService(options), options, requests, resolutions, state, target, directory, protection };
}

for (const [type, user] of [["serverless"], ["provisioned"], ["provisioned", "report_reader"]]) {
  test(`Redshift ${type}${user ? " explicit DB user" : " IAM user"} signs a target-bound connection check and survives a file-store restart`, async (t) => {
    const { service, options, requests, state, target, directory, protection } = await fixture(t, type, user);
    const connected = await service.connectApiKey(input);
    assert.equal(connected.status, "connected");
    assert.deepEqual(requests.map((r) => r.action), ["ListTables"]);
    const expected = { ...target }; if (!user) delete expected.DbUser;
    assert.deepEqual(requests[0].body, { ...expected, MaxResults: 100 });
    assert.equal(requests[0].url.origin, "https://redshift-data.us-east-1.amazonaws.com");
    assert.match(requests[0].headers.get("authorization"), /AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEKEY1234567\/\d{8}\/us-east-1\/redshift-data\/aws4_request/u);
    assert.equal(requests[0].init.redirect, "error"); assert.equal(requests[0].init.credentials, "omit");
    assert.equal(requests[0].headers.has("cookie"), false);
    for (const name of await readdir(directory)) {
      const file = await readFile(path.join(directory, name), "utf8");
      assert.equal(file.includes(state.secret), false); assert.equal(file.includes(state.key), false);
    }
    const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
    assert.deepEqual(await restarted.status(input), connected);
    state.key = "AKIAROTATEDKEY1234567";
    await restarted.invoke({ ...input, operation: "tables.list" });
    assert.ok(requests.at(-1).headers.get("authorization").includes(state.key));
    await restarted.disconnect(input);
    assert.equal((await service.status(input)).status, "disconnected");
  });
}

test("Redshift CLI and form use the same conditional fields, defaults and credential references", async (t) => {
  const { options, resolutions } = await fixture(t);
  const parse = (config) => parseIntegrationConfiguration(JSON.stringify(config), { providers: connectorDefinitions });
  assert.deepEqual(parse(options.configuration), options.configuration);
  const defaults = structuredClone(options.configuration); delete defaults.integrations.warehouse.settings.deploymentType; delete defaults.integrations.warehouse.settings.region;
  assert.equal(parse(defaults).integrations.warehouse.settings.deploymentType, "serverless");
  assert.equal(parse(defaults).integrations.warehouse.settings.region, "us-east-1");
  assert.equal(provider.settingsFields.find((f) => f.name === "region").items.length, 34);
  const serverless = getProviderSettingsSchema(provider).getFieldDefinitions();
  const provisioned = getProviderSettingsSchema(provider, { deploymentType: "provisioned" }).getFieldDefinitions();
  assert.ok(serverless.workgroup.required); assert.equal(serverless.clusterIdentifier, undefined);
  assert.ok(provisioned.clusterIdentifier.required); assert.equal(provisioned.workgroup, undefined); assert.equal(provisioned.databaseUser.required, false);
  for (const change of [{ region: "https://other.example" }, { region: "cn-north-1" }, { deploymentType: "other" }, { deploymentType: "provisioned" },
    { clusterIdentifier: "mixed-mode" }, { databaseUser: "wrong-mode" }, { workgroup: "arn:aws:example" }, { workgroup: "ab" }, { workgroup: undefined },
    { database: "\n" }, { database: "é".repeat(64) }, { accessKeyIdRef: "raw-access-key" }, { sessionTokenRef: "raw-token" }]) {
    const config = structuredClone(options.configuration); Object.assign(config.integrations.warehouse.settings, change);
    assert.throws(() => parse(config), { code: "integration_configuration_invalid" });
  }
  const perUser = structuredClone(options.configuration); perUser.integrations.warehouse.accountMode = "per-user";
  assert.throws(() => parse(perUser), { code: "integration_configuration_invalid" });
  assert.equal(resolutions.length, 0);
});

test("Redshift metadata preserves filters, exact identifiers and opaque page tokens", async (t) => {
  const { service, requests, state } = await fixture(t); await service.connectApiKey(input);
  state.response = { Tables: [table], NextToken: " page +/= " };
  const page = await service.invoke({ ...input, operation: "tables.list", input: { maxResults: 2, nextToken: " page +/= ", schemaPattern: "pub%", tablePattern: "sales_" } });
  assert.equal(page.NextToken, " page +/= ");
  assert.deepEqual(requests.at(-1).body, { Database: "dev", WorkgroupName: "analytics", MaxResults: 2, NextToken: " page +/= ", SchemaPattern: "pub%", TablePattern: "sales_" });
  state.response = undefined;
  await service.invoke({ ...input, operation: "table.describe", input: { table: " sales ", schema: " Mixed Case ", maxResults: 1 } });
  assert.equal(requests.at(-1).body.Table, " sales "); assert.equal(requests.at(-1).body.Schema, " Mixed Case ");
  for (const invalid of [{ maxResults: 1001 }, { maxResults: 0 }, { database: "other" }, { ConnectedDatabase: "other" }, { nextToken: "" }]) {
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "tables.list", input: invalid })); assert.equal(requests.length, count);
  }
});

test("Redshift submits exact parameterized SQL with caller-owned idempotency and no automatic polling", async (t) => {
  const { service, requests, state } = await fixture(t); await service.connectApiKey(input);
  const values = { sql: " select :amount::bigint;\n", clientToken: "logical-request-1", parameters: [{ name: "amount", value: "9007199254740993" }] };
  const started = await service.invoke({ ...input, operation: "query.start", input: values });
  assert.equal(started.Id, statementId);
  assert.deepEqual(requests.at(-1).body, { Database: "dev", WorkgroupName: "analytics", Sql: values.sql, ClientToken: values.clientToken, Parameters: values.parameters, ResultFormat: "JSON" });
  assert.deepEqual(requests.map((r) => r.action), ["ListTables", "ExecuteStatement"]);
  for (const change of [{ sql: " " }, { sql: "é".repeat(100001) }, { clientToken: undefined }, { clientToken: "a".repeat(65) },
    { parameters: [] }, { parameters: Array.from({ length: 101 }, (_, i) => ({ name: `p${i}`, value: "1" })) },
    { parameters: [{ name: "bad-name", value: "1" }] }, { parameters: [{ name: "amount", value: "" }] },
    { parameters: [{ name: "amount", value: "1" }, { name: "amount", value: "2" }] }, { database: "other" }, { SecretArn: "arn:aws:secretsmanager:other" }]) {
    const count = requests.length; await assert.rejects(service.invoke({ ...input, operation: "query.start", input: { ...values, ...change } })); assert.equal(requests.length, count);
  }
  state.started.Database = "other";
  await assert.rejects(service.invoke({ ...input, operation: "query.start", input: values }), { code: "connector_access_denied" });
});

test("Redshift checks statement target and ID before returning status, results or cancelling", async (t) => {
  const { service, requests, state } = await fixture(t); await service.connectApiKey(input);
  for (const operation of ["query.status", "query.results", "query.cancel"]) {
    for (const mismatch of [{ Database: "other" }, { WorkgroupName: "other" }, { ClusterIdentifier: "other" }]) {
      const old = state.statement; state.statement = { ...old, ...mismatch }; const count = requests.length;
      await assert.rejects(service.invoke({ ...input, operation, input: { statementId } }), { code: "connector_access_denied" });
      assert.deepEqual(requests.slice(count).map((r) => r.action), ["DescribeStatement"]); state.statement = old;
    }
  }
  state.statement.Id = "abcdefab-1234-1234-1234-123456789abc";
  await assert.rejects(service.invoke({ ...input, operation: "query.status", input: { statementId } }), { code: "connector_response_invalid" });
});

test("Redshift provisioned statement access checks explicit database user", async (t) => {
  const { service, state, requests } = await fixture(t, "provisioned", "report_reader"); await service.connectApiKey(input);
  state.statement.DbUser = "admin";
  await assert.rejects(service.invoke({ ...input, operation: "query.results", input: { statementId } }), { code: "connector_access_denied" });
  assert.equal(requests.at(-1).action, "DescribeStatement");
});

test("Redshift returns one result page with typed cells, nulls, empty strings and exact cursors", async (t) => {
  const { service, state, requests } = await fixture(t); await service.connectApiKey(input);
  state.results = { ColumnMetadata: [{ name: "value", typeName: "varchar" }], Records: [[{ isNull: true }], [{ stringValue: "" }], [{ stringValue: "9007199254740993" }], [{ longValue: 7 }], [{ doubleValue: 1.5 }], [{ booleanValue: false }], [{ blobValue: "AQID" }]], TotalNumRows: 7, NextToken: " next +/= " };
  const result = await service.invoke({ ...input, operation: "query.results", input: { statementId, nextToken: " previous +/= " } });
  assert.equal(result.NextToken, " next +/= "); assert.deepEqual(result.Records[2], [{ stringValue: "9007199254740993" }]);
  assert.deepEqual(result.Records[6], [{ blobValue: new Uint8Array([1, 2, 3]) }]);
  assert.deepEqual(requests.slice(-2).map((r) => r.action), ["DescribeStatement", "GetStatementResult"]);
  assert.deepEqual(requests.at(-1).body, { Id: statementId, NextToken: " previous +/= " });
  state.results.Records = [[{ longValue: 9007199254740992 }]];
  await assert.rejects(service.invoke({ ...input, operation: "query.results", input: { statementId } }), { code: "connector_response_invalid" });
});

test("Redshift exposes job states and requires a finished result set before fetching", async (t) => {
  const { service, state, requests } = await fixture(t); await service.connectApiKey(input);
  for (const status of ["SUBMITTED", "PICKED", "STARTED", "FINISHED", "ABORTED", "FAILED"]) {
    state.statement.Status = status;
    assert.equal((await service.invoke({ ...input, operation: "query.status", input: { statementId } })).Status, status);
    if (status !== "FINISHED") {
      const count = requests.length;
      await assert.rejects(service.invoke({ ...input, operation: "query.results", input: { statementId } }), { code: "connector_result_unavailable" });
      assert.equal(requests.length, count + 1);
    }
  }
  state.statement.Status = "FINISHED"; state.statement.HasResultSet = false;
  await assert.rejects(service.invoke({ ...input, operation: "query.results", input: { statementId } }), { code: "connector_result_unavailable" });
  assert.deepEqual(await service.invoke({ ...input, operation: "query.cancel", input: { statementId } }), { Status: true });
  assert.deepEqual(requests.slice(-2).map((r) => r.action), ["DescribeStatement", "CancelStatement"]);
  const count = requests.length; await service.disconnect(input); assert.equal(requests.length, count);
});

test("Redshift fails on malformed metadata, job and result responses", async (t) => {
  const { service, state } = await fixture(t); await service.connectApiKey(input);
  for (const [operation, bad] of [["tables.list", {}], ["tables.list", { Tables: [{ name: "x" }] }], ["table.describe", { ColumnList: [{}], TableName: "x" }],
    ["query.status", { Id: statementId }], ["query.start", { Id: "not-an-id" }]]) {
    state.response = bad;
    await assert.rejects(service.invoke({ ...input, operation, input: { ...(operation === "table.describe" ? { table: "sales" } : {}), ...(operation === "query.status" ? { statementId } : {}), ...(operation === "query.start" ? { sql: "select 1", clientToken: "request-1" } : {}) } }), { code: "connector_response_invalid" });
  }
});

test("Redshift credential errors, throttling and missing resources are redacted and never retried", async (t) => {
  const { service, requests, state } = await fixture(t);
  for (const [status, name, code] of [[400, "ExpiredTokenException", "connector_reconnect_required"], [403, "AccessDeniedException", "connector_permission_denied"],
    [400, "ThrottlingException", "connector_rate_limited"], [400, "ActiveStatementsExceededException", "connector_rate_limited"],
    [400, "ResourceNotFoundException", "connector_not_found"], [400, "ValidationException", "connector_configuration_invalid"], [500, "InternalServerException", "connector_provider_failed"]]) {
    state.status = status; state.response = { __type: name, Message: state.secret }; const count = requests.length;
    await assert.rejects(service.connectApiKey(input), (e) => { assert.equal(e.code, code); assert.equal(e.stack.includes(state.secret), false); return true; });
    assert.equal(requests.length, count + 1);
  }
});

test("Redshift supports explicit temporary AWS credentials, never host defaults", async (t) => {
  const { service, options, state, requests } = await fixture(t);
  state.key = undefined; await assert.rejects(service.connectApiKey(input), { code: "connector_binding_missing" });
  state.key = "ASIAEXAMPLEKEY1234567"; await assert.rejects(service.connectApiKey(input), { code: "connector_binding_missing" });
  assert.equal(requests.length, 0);
  options.configuration.integrations.warehouse.settings.sessionTokenRef = "env:AWS_SESSION_TOKEN";
  state.session = "temporary/+="; const temporary = createConnectionService(options); await temporary.connectApiKey(input);
  assert.equal(requests[0].headers.get("x-amz-security-token"), state.session);
});

test("Redshift authorizes before secrets and binds connections to owners and warehouse settings", async (t) => {
  const { service, options, requests, resolutions } = await fixture(t); await service.connectApiKey(input);
  for (const owner of [{ ...context, subjectId: "other" }, { ...context, applicationId: "other" }]) {
    await assert.rejects(service.invoke({ ...input, context: owner, operation: "tables.list" }), { code: "connector_reconnect_required" });
  }
  const configuration = structuredClone(options.configuration); configuration.integrations.warehouse.settings.workgroup = "other";
  const changed = createConnectionService({ ...options, configuration }); assert.equal((await changed.status(input)).status, "reconnect-required");
  await assert.rejects(changed.invoke({ ...input, operation: "tables.list" }), { code: "connector_reconnect_required" });
  const count = resolutions.length;
  const denied = createConnectionService({ ...options, authorize: async () => null });
  await assert.rejects(denied.invoke({ ...input, operation: "query.start", input: { sql: "select 1", clientToken: "request-1" } }), { code: "connector_access_denied" });
  assert.equal(resolutions.length, count); assert.equal(requests.length, 1);
});

test("Redshift local cancellation and timeout do not replay or silently cancel remote SQL", async (t) => {
  const { options } = await fixture(t);
  for (const [name, code] of [["AbortError", "connector_cancelled"], ["TimeoutError", "connector_provider_timeout"]]) {
    const controller = new AbortController(), actions = [];
    const interrupted = createConnectionService({ ...options, fetchImpl: async (address, init) => {
      const action = new Headers(init.headers).get("x-amz-target").split(".").at(-1);
      if (action !== "ExecuteStatement") return options.fetchImpl(address, init);
      actions.push(action); controller.abort(new DOMException("Interrupted", name)); throw new Error("wrapped");
    } });
    await interrupted.connectApiKey(input);
    await assert.rejects(interrupted.invoke({ ...input, operation: "query.start", input: { sql: "select 1", clientToken: "request-1" }, signal: controller.signal }), { code });
    assert.deepEqual(actions, ["ExecuteStatement"]);
    assert.equal((await interrupted.status(input)).status, "connected");
  }
});


test("Redshift database/schema discovery preserves native names and paging in each configured target", async (t) => {
  for (const [type, user] of [["serverless"], ["provisioned"], ["provisioned", "report_reader"]]) {
    const { service, options, requests, state, target, resolutions } = await fixture(t, type, user);
    await service.connectApiKey(input);
    const expectedTarget = { ...target }; if (!user) delete expectedTarget.DbUser;
    for (const [operation, action, field, filters] of [
      ["databases.list", "ListDatabases", "Databases", {}],
      ["schemas.list", "ListSchemas", "Schemas", { schemaPattern: "Mixed_%" }]
    ]) {
      state.response = { [field]: [" Mixed Case ", "資料"], NextToken: " next +/= " };
      const result = await service.invoke({ ...input, operation, input: { maxResults: 2, nextToken: " previous +/= ", ...filters } });
      assert.deepEqual(result, state.response);
      assert.equal(requests.at(-1).action, action);
      assert.deepEqual(requests.at(-1).body, { ...expectedTarget, MaxResults: 2, NextToken: " previous +/= ",
        ...(filters.schemaPattern ? { SchemaPattern: filters.schemaPattern } : {}) });
      state.response = { [field]: [], NextToken: "" };
      assert.deepEqual(await service.invoke({ ...input, operation }), state.response);
      for (const invalid of [{ maxResults: 1001 }, { maxResults: 0 }, { nextToken: "" },
        { database: "other" }, { ConnectedDatabase: "other" }, { workgroup: "other" }]) {
        const count = requests.length;
        await assert.rejects(service.invoke({ ...input, operation, input: invalid }));
        assert.equal(requests.length, count);
      }
      state.response = { [field]: "not-a-list" };
      await assert.rejects(service.invoke({ ...input, operation }), { code: "connector_response_invalid" });
      state.response = { [field]: [] };
      const before = resolutions.length, calls = requests.length;
      const denied = createConnectionService({ ...options, authorize: async () => false });
      await assert.rejects(denied.invoke({ ...input, operation }));
      assert.equal(resolutions.length, before); assert.equal(requests.length, calls);
    }
    assert.equal(requests.some((request) => request.action === "ExecuteStatement"), false);
  }
});
