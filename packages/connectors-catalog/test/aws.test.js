import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { awsS3Provider } from "../src/server/aws-s3.js";
import { awsAthenaProvider } from "../src/server/aws-athena.js";
import { transferS3Object } from "../patterns/aws-storage-queries/example/s3-transfer.js";

const context = { applicationId: "reports", subjectId: "owner" };
const input = { context, integrationId: "aws" };
const listXml = '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>app-files</Name><KeyCount>0</KeyCount><MaxKeys>100</MaxKeys><IsTruncated>false</IsTruncated></ListBucketResult>';
const workgroup = { WorkGroup: { Name: "primary", State: "ENABLED", Configuration: { EnforceWorkGroupConfiguration: true } } };
const query = { QueryExecution: { QueryExecutionId: "query-1", WorkGroup: "primary", Status: { State: "SUCCEEDED" } } };
const results = { ResultSet: { ResultSetMetadata: { ColumnInfo: [{ Name: "id", Type: "bigint" }] }, Rows: [{ Data: [{ VarCharValue: "id" }] }, { Data: [{}] }] }, NextToken: "opaque +/=", UpdateCount: 0 };

async function fixture(t, provider = awsS3Provider) {
  const directory = await mkdtemp(path.join(tmpdir(), "aws-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(5) }, activeKeyId: "current" });
  const requests = [], resolutions = [];
  const state = { key: "AKIAEXAMPLEKEY1234567", secret: "example-secret-not-live/+=", session: undefined,
    status: 200, xml: listXml, response: undefined };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { aws: {
      provider: provider.id, displayName: "My AWS", accountMode: "shared", scopes: provider.id === "aws-s3" ? ["read", "write"] : [],
      authentication: { method: "api-key", secretRef: "env:AWS_SECRET_ACCESS_KEY" },
      settings: { region: "us-east-1", accessKeyIdRef: "env:AWS_ACCESS_KEY_ID", ...(provider.id === "aws-s3" ? { bucket: "app-files" } : { workgroup: "primary" }) }
    } }, extensions: { fromCli: true } },
    providers: [provider], authorize: async (owner) => owner,
    resolveReference: async (ref) => {
      resolutions.push(ref);
      return { "env:AWS_ACCESS_KEY_ID": state.key, "env:AWS_SECRET_ACCESS_KEY": state.secret, "env:AWS_SESSION_TOKEN": state.session }[ref];
    },
    store: createFileConnectionStore({ directory, protection }),
    fetchImpl: async (address, init) => {
      const headers = new Headers(init.headers);
      const target = headers.get("x-amz-target")?.split(".").at(-1);
      requests.push({ url: new URL(address), init, headers, target, body: init.body && JSON.parse(init.body) });
      if (provider.id === "aws-s3") return new Response(state.xml, { status: state.status, headers: { "content-type": "application/xml" } });
      const response = state.response ?? { GetWorkGroup: workgroup, StartQueryExecution: { QueryExecutionId: "query-1" }, GetQueryExecution: query, GetQueryResults: results, StopQueryExecution: {} }[target];
      return Response.json(response, { status: state.status });
    }
  };
  return { service: createConnectionService(options), options, requests, resolutions, state, directory, protection };
}

for (const provider of [awsS3Provider, awsAthenaProvider]) {
  test(`${provider.name} signs SDK requests with explicit credentials and persists only protected connection state`, async (t) => {
    const { service, options, requests, state, directory, protection } = await fixture(t, provider);
    const connected = await service.connectApiKey(input);
    assert.equal(connected.status, "connected");
    const { headers, url, init } = requests[0];
    const serviceName = provider.id === "aws-s3" ? "s3" : "athena";
    assert.equal(url.origin, `https://${serviceName}.us-east-1.amazonaws.com`);
    assert.match(headers.get("authorization"), new RegExp(`AWS4-HMAC-SHA256 Credential=${state.key}/\\d{8}/us-east-1/${serviceName}/aws4_request`));
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(headers.has("cookie"), false);
    assert.equal(url.href.includes(state.secret), false);
    for (const name of await readdir(directory)) {
      const file = await readFile(path.join(directory, name), "utf8");
      assert.equal(file.includes(state.secret), false);
      assert.equal(file.includes(state.key), false);
    }
    const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
    assert.deepEqual(await restarted.status(input), connected);
    state.key = "AKIAROTATEDKEY1234567";
    state.secret = "rotated-secret";
    await restarted.invoke({ ...input, operation: provider.checkOperation });
    assert.ok(requests.at(-1).headers.get("authorization").includes(state.key));
    assert.notEqual(requests.at(-1).headers.get("authorization"), headers.get("authorization"));
    await restarted.disconnect(input);
    assert.equal((await service.status(input)).status, "disconnected");
  });

  test(`${provider.name} rejects unknown regions, raw keys and invalid settings before resolving credentials`, async (t) => {
    const { options, resolutions } = await fixture(t, provider);
    const parse = (config) => parseIntegrationConfiguration(JSON.stringify(config), { providers: [provider] });
    assert.deepEqual(parse(options.configuration), options.configuration);
    for (const change of [{ region: "https://other.example" }, { region: "cn-north-1" }, { accessKeyIdRef: "AKIARAWKEY123456789" }, { sessionTokenRef: "raw-token" }, { sessionTokenRef: "https://key.example" },
      ...(provider.id === "aws-s3" ? [{ bucket: "Bad_Bucket" }, { bucket: "192.168.0.1" }, { bucket: "name--x-s3" }, { bucket: "a..b" }] : [{ workgroup: "invalid/group" }, { resultLocation: "https://bucket.example" }, { resultLocation: "s3://results/a?key=secret" }])]) {
      const configuration = structuredClone(options.configuration);
      Object.assign(configuration.integrations.aws.settings, change);
      assert.throws(() => parse(configuration), { code: "integration_configuration_invalid" });
    }
    const defaults = structuredClone(options.configuration);
    delete defaults.integrations.aws.settings.region;
    if (provider.id === "aws-athena") delete defaults.integrations.aws.settings.workgroup;
    assert.equal(parse(defaults).integrations.aws.settings.region, "us-east-1");
    if (provider.id === "aws-athena") assert.equal(parse(defaults).integrations.aws.settings.workgroup, "primary");
    assert.equal(resolutions.length, 0);
  });

  test(`${provider.name} fails closed on missing credentials and signs temporary credentials without a host fallback`, async (t) => {
    const { service, options, state, requests } = await fixture(t, provider);
    for (const key of [undefined, "", "AKIA\nHEADER123456789", "ASIAEXAMPLEKEY1234567"]) {
      state.key = key;
      await assert.rejects(service.connectApiKey(input), { code: "connector_binding_missing" });
    }
    assert.equal(requests.length, 0);
    options.configuration.integrations.aws.settings.sessionTokenRef = "env:AWS_SESSION_TOKEN";
    const temporary = createConnectionService(options);
    await assert.rejects(temporary.connectApiKey(input), { code: "connector_binding_missing" });
    state.session = "session/+=value";
    await temporary.connectApiKey(input);
    assert.equal(requests[0].headers.get("x-amz-security-token"), state.session);
    assert.ok(requests[0].headers.get("authorization").includes("x-amz-security-token"));
    state.session = "rotated/session";
    await temporary.invoke({ ...input, operation: provider.checkOperation });
    assert.equal(requests[1].headers.get("x-amz-security-token"), state.session);
  });

  test(`${provider.name} isolates ownership, binds settings and authorizes before resolving secrets`, async (t) => {
    const { service, options, requests, resolutions } = await fixture(t, provider);
    await service.connectApiKey(input);
    for (const owner of [{ ...context, subjectId: "other" }, { ...context, applicationId: "other" }]) {
      await assert.rejects(service.invoke({ ...input, context: owner, operation: provider.checkOperation }), { code: "connector_reconnect_required" });
    }
    const configuration = structuredClone(options.configuration);
    configuration.integrations.aws.settings.region = "ap-southeast-2";
    const changed = createConnectionService({ ...options, configuration });
    assert.equal((await changed.status(input)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...input, operation: provider.checkOperation }), { code: "connector_reconnect_required" });
    const count = resolutions.length;
    const denied = createConnectionService({ ...options, authorize: async () => null });
    await assert.rejects(denied.invoke({ ...input, operation: provider.checkOperation }), { code: "connector_access_denied" });
    assert.equal(requests.length, 1);
    assert.equal(resolutions.length, count);
  });

  test(`${provider.name} maps AWS failures without disclosing response bodies or retrying`, async (t) => {
    const { service, state, requests } = await fixture(t, provider);
    for (const [status, name, code] of [[403, "AccessDeniedException", "connector_permission_denied"], [400, "TooManyRequestsException", "connector_rate_limited"], [400, "ExpiredTokenException", "connector_reconnect_required"], [301, "PermanentRedirect", "connector_configuration_invalid"], [404, "NoSuchBucket", "connector_not_found"], [500, "InternalError", "connector_provider_failed"]]) {
      state.status = status;
      state.xml = `<Error><Code>${name}</Code><Message>${state.secret}</Message></Error>`;
      state.response = { __type: name, Message: state.secret };
      const count = requests.length;
      await assert.rejects(service.connectApiKey(input), (error) => {
        assert.equal(error.code, code);
        assert.equal(error.stack.includes(state.secret), false);
        return true;
      });
      assert.equal(requests.length, count + 1);
      assert.equal((await service.status(input)).status, "disconnected");
    }
  });

  test(`${provider.name} cancels or times out a signed request without replay`, async (t) => {
    const { options } = await fixture(t, provider);
    for (const [failure, code] of [["AbortError", "connector_cancelled"], ["TimeoutError", "connector_provider_timeout"]]) {
      const controller = new AbortController();
      let calls = 0;
      const interrupted = createConnectionService({ ...options, fetchImpl: async () => {
        calls++;
        controller.abort(new DOMException("Interrupted", failure));
        throw new Error("Wrapped failure");
      } });
      await assert.rejects(interrupted.connectApiKey({ ...input, signal: controller.signal }), { code });
      assert.equal(calls, 1);
    }
  });
}

test("S3 lists bounded, encoded pages and rejects malformed HTTP-200 responses", async (t) => {
  const { service, state, requests } = await fixture(t);
  await service.connectApiKey(input);
  assert.equal(requests[0].url.pathname, "/app-files/");
  assert.equal(requests[0].url.searchParams.get("list-type"), "2");
  state.xml = listXml.replace("<IsTruncated>false</IsTruncated>", "<IsTruncated>true</IsTruncated><NextContinuationToken>opaque+/=</NextContinuationToken>");
  const result = await service.invoke({ ...input, operation: "objects.list", input: { prefix: " photos/ ", delimiter: "/", maxKeys: 10, continuationToken: "opaque+/=" } });
  assert.equal(result.NextContinuationToken, "opaque+/=");
  assert.equal(result.Contents, undefined);
  assert.equal(requests[1].url.searchParams.get("prefix"), " photos/ ");
  assert.equal(requests[1].url.searchParams.get("continuation-token"), "opaque+/=");
  state.xml = listXml.replace("<KeyCount>0</KeyCount>", "<KeyCount>1</KeyCount><EncodingType>url</EncodingType><Contents><Key>photo%20%2B%25.jpg</Key><Size>123</Size></Contents>");
  const encoded = await service.invoke({ ...input, operation: "objects.list" });
  assert.equal(encoded.EncodingType, "url");
  assert.equal(encoded.Contents[0].Key, "photo%20%2B%25.jpg");
  for (const xml of ["<ListBucketResult/>", listXml.replace("app-files", "other-bucket"), listXml.replace("false", "true"), listXml.replace("<KeyCount>0</KeyCount>", "<Contents><Key>a</Key></Contents>")]) {
    state.xml = xml;
    await assert.rejects(service.invoke({ ...input, operation: "objects.list" }), { code: "connector_response_invalid" });
  }
  for (const fields of [{ maxKeys: 1001 }, { maxKeys: 1.5 }, { delimiter: "x" }, { Bucket: "other" }, { endpoint: "https://other.example" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "objects.list", input: fields }), { code: "connector_input_invalid" });
  }
});

test("S3 presigns GET and PUT for exact keys with bounded expiry, read/write policy and no network use", async (t) => {
  const { service, options, state, requests } = await fixture(t);
  await service.connectApiKey(input);
  const key = " space/é +%name.txt ";
  for (const [operation, method] of [["objects.downloadUrl", "GET"], ["objects.uploadUrl", "PUT"]]) {
    const result = await service.invoke({ ...input, operation, input: { key, expiresInSeconds: 90 } });
    const url = new URL(result.url);
    assert.equal(result.method, method);
    assert.equal(result.expiresInSeconds, 90);
    assert.equal(url.origin, "https://s3.us-east-1.amazonaws.com");
    assert.equal(decodeURIComponent(url.pathname), `/app-files/${key}`);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "90");
    assert.ok(url.searchParams.get("X-Amz-Credential").startsWith(state.key + "/"));
    assert.match(url.searchParams.get("X-Amz-Signature"), /^[a-f0-9]{64}$/u);
    assert.equal(url.href.includes(state.secret), false);
  }
  for (const fields of [{ key: "../file" }, { key: "a/./file" }, { key: "é".repeat(513) }, { key: "a", expiresInSeconds: 901 }, { key: "a", expiresInSeconds: 0 }, { key: "a", Bucket: "other" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "objects.uploadUrl", input: fields }), { code: "connector_input_invalid" });
  }
  const configuration = structuredClone(options.configuration);
  configuration.integrations.aws.scopes = ["read"];
  const reader = createConnectionService({ ...options, configuration });
  await reader.connectApiKey(input);
  await assert.rejects(reader.invoke({ ...input, operation: "objects.uploadUrl", input: { key: "file" } }), { code: "connector_scope_missing" });
  assert.equal(requests.length, 2, "Only connection checks contact S3; URL construction is not upload/download proof.");
});

test("S3 application composition transfers exact binary bytes through signed GET and PUT", async (t) => {
  const { service } = await fixture(t);
  await service.connectApiKey(input);
  const bytes = new Uint8Array([0, 255, 80, 65, 82, 49, 13, 10, 128]);
  const signal = AbortSignal.timeout(5000);
  const transfers = [];
  const fetchImpl = async (address, init) => {
    const url = new URL(address);
    assert.equal(url.origin, "https://s3.us-east-1.amazonaws.com");
    assert.equal(decodeURIComponent(url.pathname), "/app-files/data/é +%.parquet");
    assert.match(url.searchParams.get("X-Amz-Signature"), /^[a-f0-9]{64}$/u);
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.signal, signal);
    assert.equal(new Headers(init.headers).has("authorization"), false);
    transfers.push(init.method);
    if (init.method === "PUT") {
      assert.deepEqual(new Uint8Array(await new Response(init.body).arrayBuffer()), bytes);
      return new Response(null, { status: 200, headers: { etag: '"object-version"' } });
    }
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 3)); controller.enqueue(bytes.slice(3)); controller.close();
    } }));
  };
  const args = { service, ...input, key: "data/é +%.parquet", signal, fetchImpl };
  const uploaded = await transferS3Object({ ...args, direction: "upload", body: bytes });
  assert.equal(uploaded.headers.get("etag"), '"object-version"');
  const downloaded = await transferS3Object({ ...args, direction: "download" });
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
  assert.deepEqual(transfers, ["PUT", "GET"]);
});

test("S3 transfer composition preserves denial, HTTP failures and uncertain writes without replay", async (t) => {
  const { service, options } = await fixture(t);
  await service.connectApiKey(input);
  let calls = 0;
  const args = { service, ...input, key: "data.bin", signal: AbortSignal.timeout(5000), direction: "upload", body: new Uint8Array([1]) };
  await assert.rejects(transferS3Object({ ...args, fetchImpl: async () => {
    calls++; throw new Error("network failure containing secret signed URL");
  } }), (error) => {
    assert.match(error.message, /completion is unknown/);
    assert.equal(error.stack.includes("secret signed URL"), false);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(calls, 1);
  for (const status of [403, 404, 500]) {
    await assert.rejects(transferS3Object({ ...args, fetchImpl: async () => {
      calls++; return new Response("private provider error", { status });
    } }), new RegExp(`HTTP ${status}`));
  }
  assert.equal(calls, 4);
  const denied = createConnectionService({ ...options, authorize: async () => null });
  await assert.rejects(transferS3Object({ ...args, service: denied, fetchImpl: async () => { calls++; } }), { code: "connector_access_denied" });
  await assert.rejects(transferS3Object({ ...args, signal: AbortSignal.abort(), fetchImpl: async () => { calls++; } }), { name: "AbortError" });
  assert.equal(calls, 4);
  const partial = await transferS3Object({ ...args, direction: "download", fetchImpl: async () => new Response(
    new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.error(new Error("truncated body")); } })
  ) });
  await assert.rejects(partial.arrayBuffer(), /truncated body/);
});

test("S3 local permissions never masquerade as an IAM grant and cannot bypass connection verification", async (t) => {
  const { options, requests, resolutions, state } = await fixture(t);
  options.configuration.integrations.aws.scopes = ["write"];
  assert.throws(() => createConnectionService(options), (error) => {
    assert.equal(error.fieldErrors["integrations.aws.scopes"], "Include this provider's required permissions.");
    return true;
  });
  assert.equal(resolutions.length, 0);
  options.configuration.integrations.aws.scopes = ["read"];
  const service = createConnectionService(options);
  assert.deepEqual((await service.connectApiKey(input)).grantedScopes, []);
  state.status = 403;
  state.xml = "<Error><Code>ExpiredToken</Code><Message>Expired session</Message></Error>";
  await assert.rejects(service.invoke({ ...input, operation: "objects.list" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
  assert.equal(requests.length, 2);
  state.status = 200;
  state.xml = listXml;
  state.key = "AKIARENEWEDKEY1234567";
  state.secret = "renewed-secret";
  assert.equal((await service.connectApiKey(input)).status, "connected");
  assert.match(requests.at(-1).headers.get("authorization"), /AKIARENEWEDKEY1234567/);
  assert.deepEqual(await service.disconnect(input), { status: "disconnected" });
  assert.equal((await service.status(input)).status, "disconnected");
  await assert.rejects(service.invoke({ ...input, operation: "objects.downloadUrl", input: { key: "private.txt" } }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, 3, "Disconnect is local and cannot revoke an already issued presigned URL.");
});

test("Athena never runs SQL on connect and sends the caller's exact statement and idempotency token", async (t) => {
  const { service, options, requests } = await fixture(t, awsAthenaProvider);
  await service.connectApiKey(input);
  assert.deepEqual(requests.map((r) => r.target), ["GetWorkGroup"]);
  const configuration = structuredClone(options.configuration);
  configuration.integrations.aws.settings.resultLocation = "s3://query-results/reports/";
  let authorized;
  const configured = createConnectionService({ ...options, configuration, authorize: async (owner, request) => { authorized = request; return owner; } });
  await configured.connectApiKey(input);
  const fields = { sql: " SELECT '  value  ' ", clientRequestToken: "idempotency-key-for-this-query-0001", database: "reports", catalog: "AwsDataCatalog" };
  const result = await configured.invoke({ ...input, operation: "query.start", input: fields });
  assert.equal(result.QueryExecutionId, "query-1");
  assert.deepEqual(authorized.input, fields);
  assert.deepEqual(requests.at(-1).body, { QueryString: fields.sql, ClientRequestToken: fields.clientRequestToken, WorkGroup: "primary", QueryExecutionContext: { Database: "reports", Catalog: "AwsDataCatalog" }, ResultConfiguration: { OutputLocation: "s3://query-results/reports/" } });
  await configured.invoke({ ...input, operation: "query.start", input: fields });
  assert.equal(requests.at(-1).body.ClientRequestToken, fields.clientRequestToken);
  for (const invalid of [{ sql: "SELECT 1" }, { ...fields, clientRequestToken: "short" }, { ...fields, sql: "" }, { ...fields, sql: "  " }, { ...fields, sql: "é".repeat(131073) }, { ...fields, workgroup: "other" }, { ...fields, resultLocation: "s3://other/" }]) {
    await assert.rejects(configured.invoke({ ...input, operation: "query.start", input: invalid }), { code: "connector_input_invalid" });
  }
});

test("Athena verifies workgroup before status/results/cancel and preserves result headers, empty cells and cursors", async (t) => {
  const { service, state, requests } = await fixture(t, awsAthenaProvider);
  await service.connectApiKey(input);
  assert.deepEqual(await service.invoke({ ...input, operation: "query.status", input: { queryId: "query-1" } }), query);
  assert.deepEqual(await service.invoke({ ...input, operation: "query.results", input: { queryId: "query-1", maxResults: 25, nextToken: "opaque +/=" } }), results);
  assert.deepEqual(requests.slice(-2).map((r) => r.target), ["GetQueryExecution", "GetQueryResults"]);
  assert.deepEqual(requests.at(-1).body, { QueryExecutionId: "query-1", MaxResults: 25, QueryResultType: "DATA_ROWS", NextToken: "opaque +/=" });
  assert.deepEqual(await service.invoke({ ...input, operation: "query.cancel", input: { queryId: "query-1" } }), {});
  assert.deepEqual(requests.slice(-2).map((r) => r.target), ["GetQueryExecution", "StopQueryExecution"]);
  state.response = { QueryExecution: { ...query.QueryExecution, WorkGroup: "private" } };
  for (const operation of ["query.status", "query.results", "query.cancel"]) {
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation, input: { queryId: "query-1" } }), { code: "connector_access_denied" });
    assert.equal(requests.length, count + 1);
    assert.equal(requests.at(-1).target, "GetQueryExecution");
  }
  state.response = { QueryExecution: { ...query.QueryExecution, QueryExecutionId: "other-query" } };
  await assert.rejects(service.invoke({ ...input, operation: "query.status", input: { queryId: "query-1" } }), { code: "connector_response_invalid" });
});

test("Athena rejects malformed verification and results, validates pagination and returns all job states", async (t) => {
  const { service, state, options } = await fixture(t, awsAthenaProvider);
  for (const response of [{}, { WorkGroup: { Name: "other", State: "ENABLED" } }, { WorkGroup: { Name: "primary" } }]) {
    state.response = response;
    await assert.rejects(service.connectApiKey(input), { code: "connector_response_invalid" });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  state.response = undefined;
  await service.connectApiKey(input);
  for (const status of ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]) {
    state.response = { QueryExecution: { ...query.QueryExecution, Status: { State: status } } };
    const value = await service.invoke({ ...input, operation: "query.status", input: { queryId: "query-1" } });
    assert.equal(value.QueryExecution.Status.State, status);
  }
  for (const fields of [{ queryId: " " }, { queryId: "query-1", maxResults: 0 }, { queryId: "query-1", maxResults: 1.5 }, { queryId: "query-1", nextToken: "" }, { queryId: "query-1", queryResultType: "DATA_MANIFEST" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "query.results", input: fields }), { code: "connector_input_invalid" });
  }
  const malformed = createConnectionService({ ...options, fetchImpl: async (_, init) => {
    const target = new Headers(init.headers).get("x-amz-target");
    return Response.json(target.endsWith("GetQueryExecution") ? query : { ResultSet: {} });
  } });
  await assert.rejects(malformed.invoke({ ...input, operation: "query.results", input: { queryId: "query-1" } }), { code: "connector_response_invalid" });
});

test("Athena browses catalogs, databases and typed table metadata with opaque pagination", async (t) => {
  const { service, options, state, requests, resolutions } = await fixture(t, awsAthenaProvider);
  await service.connectApiKey(input);
  const cases = [
    ["catalogs.list", "ListDataCatalogs", {}, { DataCatalogsSummary: [{ CatalogName: "AwsDataCatalog", Type: "GLUE" }] }],
    ["databases.list", "ListDatabases", { catalog: "AwsDataCatalog" }, { DatabaseList: [{ Name: "reports", Description: "Reporting data" }] }],
    ["tables.list", "ListTableMetadata", { catalog: "AwsDataCatalog", database: "reports" }, { TableMetadataList: [{ Name: "orders", Columns: [{ Name: "amount", Type: "decimal(38,2)" }], PartitionKeys: [{ Name: "day", Type: "date" }] }] }]
  ];
  for (const [operation, target, fields, response] of cases) {
    state.response = { ...response, NextToken: "opaque +/=" };
    const value = await service.invoke({ ...input, operation, input: { ...fields, maxResults: 2, nextToken: "previous +/=" } });
    assert.deepEqual(value, state.response);
    assert.equal(requests.at(-1).target, target);
    assert.deepEqual(requests.at(-1).body, { WorkGroup: "primary", MaxResults: 2, NextToken: "previous +/=",
      ...(fields.catalog ? { CatalogName: fields.catalog } : {}), ...(fields.database ? { DatabaseName: fields.database } : {}) });
    state.response = { [Object.keys(response)[0]]: [] };
    assert.deepEqual(await service.invoke({ ...input, operation, input: fields }), state.response);
    state.response = { ...response, NextToken: "" };
    await assert.rejects(service.invoke({ ...input, operation, input: fields }), { code: "connector_response_invalid" });
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation, input: { ...fields, maxResults: 51 } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, count);
  }
  state.response = { TableMetadataList: [{ Name: "orders", Columns: [{ Name: "bad", Type: 42 }] }] };
  await assert.rejects(service.invoke({ ...input, operation: "tables.list", input: { catalog: "AwsDataCatalog", database: "reports" } }), { code: "connector_response_invalid" });
  await assert.rejects(service.invoke({ ...input, operation: "catalogs.list", input: { maxResults: 1 } }), { code: "connector_input_invalid" });
  const denied = createConnectionService({ ...options, authorize: async () => { throw new Error("Catalog not authorized"); } });
  const count = resolutions.length;
  await assert.rejects(denied.invoke({ ...input, operation: "databases.list", input: { catalog: "private" } }), /Catalog not authorized/);
  assert.equal(resolutions.length, count);
  assert.equal(requests.some((r) => r.target === "StartQueryExecution"), false);
});
