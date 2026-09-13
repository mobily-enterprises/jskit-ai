import { googleCalendarProvider } from "../../connector-google-calendar/src/server/provider.js";
import { googleAnalyticsDefinition } from "../src/shared/google.js";
import { validateIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { gmailProvider } from "../src/server/gmail.js";
import { googleDriveProvider } from "../src/server/google-drive.js";
import { googleSheetsProvider } from "../src/server/google-sheets.js";
import { googleDocsProvider } from "../src/server/google-docs.js";
import { googleSlidesProvider } from "../src/server/google-slides.js";
import { googleSearchConsoleProvider } from "../src/server/google-search-console.js";

import { bigqueryProvider } from "../src/server/bigquery.js";

const owner = { applicationId: "application", subjectId: "user-one" };
const callback = "https://application.example/connections/callback";
const cases = [
  { provider: bigqueryProvider, settings: { projectId: "query-project" }, verificationInput: {}, expectedPath: "/bigquery/v2/projects", response: { kind: "bigquery#projectList", projects: [{ id: "project-1", projectReference: { projectId: "project-1" } }], totalItems: 1, nextPageToken: "next" } },
  { provider: gmailProvider, verificationInput: {}, expectedPath: "/gmail/v1/users/me/profile", response: { emailAddress: "user@example.com", messagesTotal: 2, threadsTotal: 1, historyId: "100" } },
  { provider: googleDriveProvider, verificationInput: {}, expectedPath: "/drive/v3/files", response: { kind: "drive#fileList", files: [{ id: "file" }], nextPageToken: "next" } },
  { provider: googleSheetsProvider, verificationInput: { spreadsheetId: "sheet_1" }, expectedPath: "/v4/spreadsheets/sheet_1", response: { spreadsheetId: "sheet_1", properties: { title: "Budget" } } },
  { provider: googleDocsProvider, verificationInput: { documentId: "document_1" }, expectedPath: "/v1/documents/document_1", response: { documentId: "document_1", title: "Notes", tabs: [] } },
  { provider: googleSlidesProvider, verificationInput: { presentationId: "slides_1" }, expectedPath: "/v1/presentations/slides_1", response: { presentationId: "slides_1", title: "Slides", slides: [] } },
  { provider: googleSearchConsoleProvider, verificationInput: {}, expectedPath: "/webmasters/v3/sites", response: { siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] } }
];

async function fixture(t, entry) {
  const directory = await mkdtemp(path.join(tmpdir(), "google-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scopes = entry.provider.scopes.filter((scope) => scope.recommended).map((scope) => scope.value);
  const config = {
    schemaVersion: 1, integrations: { provider: { provider: entry.provider.id, accountMode: "per-user", scopes, ...(entry.settings ? { settings: entry.settings } : {}), authentication: { method: "oauth2", registrationRef: "google" } } },
    registrations: { google: { source: "own", clientId: "test-client", clientSecretRef: "env:SECRET", callbackUrlRef: "env:CALLBACK" } }
  };
  const options = {
    configuration: config, providers: [entry.provider], authorize: async (context) => context,
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(3) }, activeKeyId: "current" }) }),
    resolveReference: async (ref) => ref === "env:CALLBACK" ? callback : "test-client-secret",
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(String(url)), init });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "Bearer", expires_in: 3600, scope: state.scopes.join(" ") });
      }
      if (state.bytes) return new Response(state.bytes, { status: state.status, headers: { "Content-Type": "application/pdf" } });
      return state.status === 204 ? new Response(null, { status: 204 }) : Response.json(state.response, { status: state.status });
    }
  };
  const requests = [];
  const state = { scopes, response: entry.response, status: 200 };
  const service = createConnectionService(options);
  const input = { context: owner, integrationId: "provider" };
  async function start() {
    const { authorizationUrl } = await service.beginAuthorization({ ...input, verificationInput: entry.verificationInput });
    const url = new URL(authorizationUrl);
    return { url, callbackUrl: `${callback}?code=code&state=${url.searchParams.get("state")}` };
  }
  return { service, options, input, start, requests, state };
}

for (const entry of cases) {
  test(`${entry.provider.id}: verifies access with its own scopes and request, then survives restart`, async (t) => {
    assert.deepEqual(entry.provider.verificationFields.map((field) => field.name), Object.keys(entry.verificationInput));
    const { service, options, input, start, requests, state } = await fixture(t, entry);
    const { url, callbackUrl } = await start();
    assert.equal(url.searchParams.get("scope"), state.scopes.join(" "));
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const result = await service.completeAuthorization({ ...input, callbackUrl });
    assert.equal(result.status, "connected");
    if (entry.provider.id === "gmail") assert.equal(result.accountLabel, entry.response.emailAddress);
    else assert.equal(result.accountLabel, undefined);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url.origin, entry.provider.apiOrigins[0]);
    assert.equal(requests[1].url.pathname, entry.expectedPath);
    assert.equal(new Headers(requests[1].init.headers).get("authorization"), "Bearer test-access-token");
    assert.equal(requests[1].init.redirect, "error");
    const restarted = createConnectionService(options);
    assert.equal((await restarted.status(input)).status, "connected");
    assert.equal((await restarted.status(input)).accountLabel, result.accountLabel);
    assert.deepEqual(await restarted.invoke({ ...input, operation: entry.provider.checkOperation, input: entry.verificationInput }), entry.response);
    assert.equal(JSON.stringify(await restarted.status(input)).includes("test-access-token"), false);
    await assert.rejects(restarted.invoke({ ...input, context: { ...owner, subjectId: "different-user" }, operation: entry.provider.checkOperation, input: entry.verificationInput }), { code: "connector_reconnect_required" });
    await restarted.disconnect(input);
    await assert.rejects(restarted.invoke({ ...input, operation: entry.provider.checkOperation, input: entry.verificationInput }), { code: "connector_reconnect_required" });
  });

  test(`${entry.provider.id}: missing consent and malformed provider responses cannot report connected`, async (t) => {
    const { service, input, start, state, requests } = await fixture(t, entry);
    const { callbackUrl } = await start();
    state.scopes = [];
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl }), { code: "connector_scope_missing" });
    assert.equal(requests.length, 1);
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl }), { code: "connector_attempt_invalid" });
    assert.equal((await service.status(input)).status, "disconnected");
    state.scopes = entry.provider.scopes.filter((scope) => scope.recommended).map((scope) => scope.value);
    state.response = { error: "test-client-secret" };
    const next = await start();
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: next.callbackUrl }), { code: "connector_response_invalid" });
    assert.equal((await service.status(input)).status, "disconnected");
  });

  test(`${entry.provider.id}: input errors and permission/rate limits are controlled failures`, async (t) => {
    const { service, input, start, state, requests } = await fixture(t, entry);
    const { callbackUrl } = await start();
    await service.completeAuthorization({ ...input, callbackUrl });
    const before = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: entry.provider.checkOperation, input: { ...entry.verificationInput, unknownInput: "reject" } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, before);
    for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"]]) {
      state.status = status;
      state.response = { error: { message: "test-client-secret" } };
      await assert.rejects(service.invoke({ ...input, operation: entry.provider.checkOperation, input: entry.verificationInput }), (error) => {
        assert.equal(error.code, code);
        assert.equal(JSON.stringify(error).includes("test-client-secret"), false);
        return true;
      });
    }
  });
}

test("Gmail rejects invalid account labels without storing a connected grant", async (t) => {
  const entry = cases.find((entry) => entry.provider.id === "gmail");
  const { service, input, start, state } = await fixture(t, entry);
  for (const emailAddress of ["", " ", "x".repeat(257), "person\n@example.test", "person\u202E@example.test"]) {
    state.response = { ...entry.response, emailAddress };
    const { callbackUrl } = await start();
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl }), { code: "connector_response_invalid" });
    assert.deepEqual(await service.status(input), { status: "disconnected", callbackUrl: callback });
  }
});

test("document verification requires a valid resource ID before creating a consent attempt", async (t) => {
  for (const entry of cases.filter((entry) => Object.keys(entry.verificationInput).length)) {
    const { service, input, requests } = await fixture(t, entry);
    if (entry.provider.verificationFields.some(field => field.required)) await assert.rejects(service.beginAuthorization(input), (error) => Boolean(error.fieldErrors));
    await assert.rejects(service.beginAuthorization({ ...input, verificationInput: Object.fromEntries(Object.keys(entry.verificationInput).map((key) => [key, "../wrong"])) }), (error) => Boolean(error.fieldErrors));
    assert.equal(requests.length, 0);
  }
});

test("Gmail, Drive and Sheets operations retain pagination, repeated labels and encoded ranges", () => {
  const messages = new URL(gmailProvider.operations["messages.list"].request({ pageToken: "next & page", maxResults: 2, labelIds: ["INBOX", "UNREAD"] }).url);
  assert.deepEqual(messages.searchParams.getAll("labelIds"), ["INBOX", "UNREAD"]);
  assert.equal(messages.searchParams.get("pageToken"), "next & page");
  assert.equal(messages.searchParams.get("maxResults"), "2");
  assert.equal(new URL(gmailProvider.operations["messages.get"].request({ id: "msg_1" }).url).searchParams.get("format"), "metadata");
  const files = new URL(googleDriveProvider.operations["files.list"].request({ driveId: "shared-drive", pageSize: 12, pageToken: "cursor" }).url);
  assert.equal(files.searchParams.get("corpora"), "drive");
  assert.equal(files.searchParams.get("supportsAllDrives"), "true");
  assert.equal(files.searchParams.get("pageSize"), "12");
  assert.equal(files.searchParams.get("pageToken"), "cursor");
  const cells = new URL(googleSheetsProvider.operations["values.get"].request({ spreadsheetId: "sheet_1", range: "'A & B'!A1:D5" }).url);
  assert.equal(decodeURIComponent(cells.pathname), "/v4/spreadsheets/sheet_1/values/'A & B'!A1:D5");
  assert.equal(googleSearchConsoleProvider.operations["sites.list"].validateResult({}), true);
});


test("BigQuery preserves paging and valid empty Google responses", () => {
  for (const [provider, operation, field, maximum] of [
    [bigqueryProvider, "projects.list", "maxResults", 50]
  ]) {
    const request = provider.operations[operation];
    const url = new URL(request.request({ [field]: 2, pageToken: "opaque & next" }).url);
    assert.equal(url.searchParams.get(field), "2");
    assert.equal(url.searchParams.get("pageToken"), "opaque & next");
    assert.equal(new URL(request.request({}).url).searchParams.get(field), "50");
    for (const value of [0, maximum + 1]) assert.throws(() => request.request({ [field]: value }));
    assert.equal(request.validateResult({ error: { code: 403 } }), false);
  }
  assert.equal(bigqueryProvider.operations["projects.list"].validateResult({ totalItems: 0 }), true);
  assert.equal(bigqueryProvider.operations["projects.list"].validateResult({ totalItems: 1 }), false);
  assert.equal(bigqueryProvider.operations["projects.list"].validateResult({ projects: [], totalItems: -1 }), false);
});


test("captured auxiliary Google scopes round-trip without granting unrelated read operations", async (t) => {
  for (const [provider, suffixes] of [
    [googleDriveProvider, ["drive.appfolder", "drive.appdata"]],
    [googleSheetsProvider, ["drive.metadata.readonly"]],
    [googleSearchConsoleProvider, ["siteverification", "siteverification.verify_only"]]
  ]) {
    const entry = cases.find((entry) => entry.provider === provider);
    const { options, input, requests } = await fixture(t, entry);
    const auxiliary = suffixes.map((suffix) => `https://www.googleapis.com/auth/${suffix}`);
    for (const scope of auxiliary) {
      assert.ok(provider.scopes.some((choice) => choice.value === scope && !choice.required));
      assert.equal(provider.operations[provider.checkOperation].scopes.includes(scope), false);
    }
    options.configuration.integrations.provider.scopes = [...new Set([...options.configuration.integrations.provider.scopes, ...auxiliary])];
    const service = createConnectionService(options);
    const result = await service.beginAuthorization({ ...input, verificationInput: entry.verificationInput });
    const requested = new URL(result.authorizationUrl).searchParams.get("scope").split(" ");
    for (const scope of auxiliary) assert.ok(requested.includes(scope));
    assert.equal(requests.length, 0);
  }
});


test("Analytics accepts public tracking configuration and rejects the old OAuth reader", () => {
  const input = { schemaVersion: 1, registrations: {}, integrations: { analytics: {
    provider: "google-analytics", accountMode: "shared", scopes: [],
    authentication: { method: "none" }, settings: { measurementId: "G-ABC1234567" }
  } } };
  const validate = (value) => validateIntegrationConfiguration(value, { providers: [googleAnalyticsDefinition] });
  assert.deepEqual(validate(JSON.parse(JSON.stringify(input))), input);
  for (const measurementId of ["", "MISSING", "UA-123-1", "G-<script>", "G-ABC 123"]) {
    const invalid = structuredClone(input);
    invalid.integrations.analytics.settings.measurementId = measurementId;
    assert.throws(() => validate(invalid), { code: "integration_configuration_invalid" });
  }
  const missing = structuredClone(input);
  delete missing.integrations.analytics.settings;
  assert.throws(() => validate(missing));
  for (const authentication of [{ method: "api-key", secretRef: "env:KEY" }, { method: "oauth2", registrationRef: "google" }]) {
    const invalid = structuredClone(input);
    invalid.integrations.analytics.authentication = authentication;
    assert.throws(() => validate(invalid));
  }
  assert.equal(googleAnalyticsDefinition.configurationOnly, true);
});


test("Drive captured defaults require file access but allow optional permissions to be removed", async (t) => {
  const entry = cases.find((entry) => entry.provider === googleDriveProvider);
  const { options } = await fixture(t, entry);
  const suffix = (value) => `https://www.googleapis.com/auth/${value}`;
  assert.deepEqual(new Set(options.configuration.integrations.provider.scopes), new Set([
    "drive.file", "drive.appdata", "drive.appfolder", "drive.readonly"
  ].map(suffix)));
  options.configuration.integrations.provider.scopes = [suffix("drive.file")];
  assert.doesNotThrow(() => validateIntegrationConfiguration(options.configuration, { providers: [googleDriveProvider] }));
  options.configuration.integrations.provider.scopes = [suffix("drive.readonly")];
  assert.throws(() => validateIntegrationConfiguration(options.configuration, { providers: [googleDriveProvider] }),
    { code: "integration_configuration_invalid" });
});


test("Gmail captured defaults permit a read-only configuration but require its read permission", async (t) => {
  const entry = cases.find((entry) => entry.provider === gmailProvider);
  const { options } = await fixture(t, entry);
  const scope = (suffix) => `https://www.googleapis.com/auth/${suffix}`;
  assert.deepEqual(options.configuration.integrations.provider.scopes,
    ["gmail.readonly", "gmail.send", "gmail.compose", "gmail.modify"].map(scope));
  options.configuration.integrations.provider.scopes = [scope("gmail.readonly")];
  assert.doesNotThrow(() => validateIntegrationConfiguration(options.configuration, { providers: [gmailProvider] }));
  options.configuration.integrations.provider.scopes = [scope("gmail.send")];
  assert.throws(() => validateIntegrationConfiguration(options.configuration, { providers: [gmailProvider] }));
});


test("BigQuery preserves its query project and rejects missing or malformed project IDs", async (t) => {
  const { options } = await fixture(t, cases.find((entry) => entry.provider === bigqueryProvider));
  const validate = (input) => validateIntegrationConfiguration(input, { providers: [bigqueryProvider] });
  assert.equal(validate(options.configuration).integrations.provider.settings.projectId, "query-project");
  for (const projectId of ["", "123456789", "https://example.com", "UPPERCASE", "invalid-"]) {
    const invalid = structuredClone(options.configuration);
    invalid.integrations.provider.settings.projectId = projectId;
    assert.throws(() => validate(invalid));
  }
  const invalid = structuredClone(options.configuration);
  delete invalid.integrations.provider.settings;
  assert.throws(() => validate(invalid));
});


test("BigQuery submits to the configured project and retains incomplete and paged results", async (t) => {
  const { service, input, start, state, requests } = await fixture(t, cases.find((entry) => entry.provider === bigqueryProvider));
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  state.response = { jobComplete: false, jobReference: { projectId: "query-project", jobId: "job_123", location: "EU" } };
  const pending = await service.invoke({ ...input, operation: "jobs.query", input: {
    query: "SELECT 1", maximumBytesBilled: "1000000", requestId: "request-1", location: "EU"
  } });
  assert.equal(pending.jobComplete, false);
  const submitted = requests.at(-1);
  assert.equal(submitted.url.pathname, "/bigquery/v2/projects/query-project/queries");
  assert.equal(submitted.init.method, "POST");
  assert.deepEqual(JSON.parse(submitted.init.body), {
    query: "SELECT 1", maximumBytesBilled: "1000000", requestId: "request-1", location: "EU",
    maxResults: 100, timeoutMs: 1000, useLegacySql: false
  });
  state.response = { jobComplete: true, rows: [{ f: [{ v: "1" }] }], totalRows: "2", pageToken: "next-page" };
  assert.deepEqual(await service.invoke({ ...input, operation: "jobs.getQueryResults", input: {
    jobId: pending.jobReference.jobId, location: "EU", pageToken: "previous-page"
  } }), state.response);
  assert.equal(requests.at(-1).url.pathname, "/bigquery/v2/projects/query-project/queries/job_123");
  assert.equal(requests.at(-1).url.searchParams.get("pageToken"), "previous-page");
  assert.equal(requests.at(-1).url.searchParams.get("location"), "EU");
  const before = requests.length;
  for (const [operation, values] of [
    ["jobs.query", { query: "SELECT 1", projectId: "other-project" }],
    ["jobs.query", { query: "" }],
    ["jobs.query", { query: "SELECT 1", maximumBytesBilled: "-1" }],
    ["jobs.getQueryResults", { jobId: "../other-project" }]
  ]) await assert.rejects(service.invoke({ ...input, operation, input: values }), { code: "connector_input_invalid" });
  assert.equal(requests.length, before);
  state.response = { jobComplete: false };
  await assert.rejects(service.invoke({ ...input, operation: "jobs.query", input: { query: "SELECT 1" } }), { code: "connector_response_invalid" });
});


test("BigQuery named parameters keep values separate from SQL and reject ambiguous names", async (t) => {
  const { service, input, start, state, requests } = await fixture(t, cases.find((entry) => entry.provider === bigqueryProvider));
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  state.response = { jobComplete: true, rows: [], totalRows: "0" };
  const query = "SELECT @name AS name";
  const value = "  '; DROP TABLE customers; --  ";
  await service.invoke({ ...input, operation: "jobs.query", input: { query, parameters: [{ name: "name", type: "STRING", value }] } });
  const body = JSON.parse(requests.at(-1).init.body);
  assert.equal(body.query, query);
  assert.equal(body.parameterMode, "NAMED");
  assert.deepEqual(body.queryParameters, [{ name: "name", parameterType: { type: "STRING" }, parameterValue: { value } }]);
  assert.equal(Object.hasOwn(body, "parameters"), false);
  const before = requests.length;
  for (const parameters of [
    [{ name: "name", type: "STRING", value }, { name: "name", type: "STRING", value: "other" }],
    [{ name: "@name", type: "STRING", value }],
    [{ name: "name", type: "ARRAY", value }]
  ]) await assert.rejects(service.invoke({ ...input, operation: "jobs.query", input: { query, parameters } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, before);
});

test("BigQuery discovers datasets and table schemas and inspects/cancels jobs without submitting SQL", async (t) => {
  const { service, options, input, start, state, requests } = await fixture(t, cases.find((entry) => entry.provider === bigqueryProvider));
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  const job = { jobReference: { projectId: "query-project", jobId: "job_123", location: "EU" }, status: { state: "RUNNING" } };
  const entries = [
    ["datasets.list", { maxResults: 2, pageToken: " next +/= " }, "/datasets", { datasets: [{ datasetReference: { projectId: "query-project", datasetId: "sales" } }], nextPageToken: " next +/= " }],
    ["tables.list", { datasetId: "sales", maxResults: 2 }, "/datasets/sales/tables", { tables: [{ tableReference: { projectId: "query-project", datasetId: "sales", tableId: "orders" } }] }],
    ["tables.get", { datasetId: "sales", tableId: "注文" }, "/datasets/sales/tables/%E6%B3%A8%E6%96%87", { tableReference: { projectId: "query-project", datasetId: "sales", tableId: "注文" }, schema: { fields: [{ name: "amount", type: "NUMERIC", mode: "NULLABLE" }] } }],
    ["jobs.get", { jobId: "job_123", location: "EU" }, "/jobs/job_123", job],
    ["jobs.cancel", { jobId: "job_123", location: "EU" }, "/jobs/job_123/cancel", { job }]
  ];
  const initial = requests.length;
  for (const [operation, values, suffix, response] of entries) {
    state.response = response;
    assert.deepEqual(await service.invoke({ ...input, operation, input: values }), response);
    const request = requests.at(-1);
    assert.equal(request.url.pathname, `/bigquery/v2/projects/query-project${suffix}`);
    assert.equal(request.init.method, operation === "jobs.cancel" ? "POST" : "GET");
    assert.equal(request.init.body, undefined);
    if (values.pageToken) assert.equal(request.url.searchParams.get("pageToken"), values.pageToken);
    if (values.location) assert.equal(request.url.searchParams.get("location"), "EU");
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation, input: { ...values, projectId: "other" } }), { code: "connector_input_invalid" });
    await assert.rejects(service.invoke({ ...input, context: { ...owner, subjectId: "other" }, operation, input: values }), { code: "connector_reconnect_required" });
    const denied = createConnectionService({ ...options, authorize: async () => null });
    await assert.rejects(denied.invoke({ ...input, operation, input: values }));
    assert.equal(requests.length, count);
    state.response = { datasets: "bad", tables: "bad", jobReference: {}, schema: "bad" };
    await assert.rejects(service.invoke({ ...input, operation, input: values }), { code: "connector_response_invalid" });
  }
  assert.equal(requests.slice(initial).some((request) => request.url.pathname.endsWith("/queries")), false);
  state.response = {};
  assert.deepEqual(await service.invoke({ ...input, operation: "datasets.list" }), {});
  assert.deepEqual(await service.invoke({ ...input, operation: "tables.list", input: { datasetId: "sales" } }), {});
  for (const value of ["../elsewhere", "x/y", "x\\y", "\n"]) {
    await assert.rejects(service.invoke({ ...input, operation: "tables.get", input: { datasetId: value, tableId: "orders" } }), { code: "connector_input_invalid" });
  }
  for (const stateName of ["PENDING", "RUNNING", "DONE"]) {
    state.response = { ...job, status: { state: stateName, ...(stateName === "DONE" ? { errorResult: { reason: "stopped", message: "Job cancelled" } } : {}) } };
    assert.deepEqual(await service.invoke({ ...input, operation: "jobs.get", input: { jobId: "job_123" } }), state.response);
  }
});

test("BigQuery preserves exact SQL and typed nested results and does not replay failed cancellation", async (t) => {
  const { service, input, start, state, requests } = await fixture(t, cases.find((entry) => entry.provider === bigqueryProvider));
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  state.response = { jobComplete: true, totalRows: "9007199254740993", pageToken: " next +/= ",
    schema: { fields: [{ name: "amount", type: "BIGNUMERIC" }, { name: "details", type: "RECORD", fields: [{ name: "name", type: "STRING" }] }, { name: "tags", type: "STRING", mode: "REPEATED" }] },
    rows: [{ f: [{ v: "12345678901234567890.123456789" }, { v: { f: [{ v: "" }] } }, { v: [{ v: "a" }, { v: "b" }] }] }, { f: [{ v: null }, { v: null }, { v: [] }] }] };
  const sql = " \nSELECT amount, details, tags FROM reports\n";
  assert.deepEqual(await service.invoke({ ...input, operation: "jobs.query", input: { query: sql } }), state.response);
  assert.equal(JSON.parse(requests.at(-1).init.body).query, sql);
  assert.deepEqual(await service.invoke({ ...input, operation: "jobs.getQueryResults", input: { jobId: "job_1", pageToken: " previous +/= " } }), state.response);
  assert.equal(requests.at(-1).url.searchParams.get("pageToken"), " previous +/= ");
  for (const change of [{ rows: [{}] }, { rows: [{ f: [{}] }] }, { schema: {} }, { pageToken: 123 }, { totalRows: 9007199254740992 }]) {
    const old = state.response; state.response = { ...old, ...change };
    await assert.rejects(service.invoke({ ...input, operation: "jobs.getQueryResults", input: { jobId: "job_1" } }), { code: "connector_response_invalid" });
    state.response = old;
  }
  for (const [status, code] of [[400, "connector_provider_failed"], [403, "connector_permission_denied"], [404, "connector_provider_failed"], [429, "connector_rate_limited"], [503, "connector_provider_failed"]]) {
    state.status = status; state.response = { error: { message: "test-access-token private query" } };
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "jobs.cancel", input: { jobId: "job_1", location: "EU" } }), (error) => {
      assert.equal(error.code, code); assert.equal(error.message.includes("private query"), false); assert.equal(error.message.includes("test-access-token"), false); return true;
    });
    assert.equal(requests.length, count + 1);
  }
});

test("Gmail reads full MIME bodies, attachments and search and gates explicit mailbox writes by granted scopes", async t => {
  const { service, options, input, start, state, requests } = await fixture(t, cases.find(entry => entry.provider === gmailProvider));
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  const message = { id: "msg_1", threadId: "thread_1", payload: { mimeType: "multipart/mixed", parts: [
    { mimeType: "text/plain", body: { data: Buffer.from("Customer appointment").toString("base64url"), size: 20 } },
    { filename: "invoice.pdf", body: { attachmentId: "attachment_1", size: 7 } }
  ] } };
  state.response = message;
  assert.deepEqual(await service.invoke({ ...input, operation: "messages.read", input: { id: "msg_1" } }), message);
  assert.equal(requests.at(-1).url.searchParams.get("format"), "full");
  const attachment = { data: Buffer.from("PDFDATA").toString("base64url"), size: 7 };
  state.response = attachment;
  assert.deepEqual(await service.invoke({ ...input, operation: "attachments.get", input: { messageId: "msg_1", id: "attachment_1" } }), attachment);
  assert.equal(requests.at(-1).url.pathname, "/gmail/v1/users/me/messages/msg_1/attachments/attachment_1");
  state.response = { messages: [{ id: "msg_1", threadId: "thread_1" }], resultSizeEstimate: 2, nextPageToken: "next & page" };
  const found = await service.invoke({ ...input, operation: "messages.search", input: { q: "from:customer@example.test has:attachment", pageToken: "previous & page" } });
  assert.equal(found.nextPageToken, "next & page");
  assert.equal(requests.at(-1).url.searchParams.get("q"), "from:customer@example.test has:attachment");
  assert.equal(requests.at(-1).url.searchParams.get("pageToken"), "previous & page");
  const raw = Buffer.from("From: owner@example.test\r\nTo: customer@example.test\r\nSubject: Booking\r\n\r\nConfirmed").toString("base64url");
  state.response = message;
  await service.invoke({ ...input, operation: "messages.send", input: { raw, threadId: "thread_1" } });
  assert.equal(requests.at(-1).init.method, "POST");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { raw, threadId: "thread_1" });
  await service.invoke({ ...input, operation: "messages.modify", input: { id: "msg_1", removeLabelIds: ["UNREAD", "INBOX"] } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { removeLabelIds: ["UNREAD", "INBOX"] });
  for (const operation of ["messages.trash", "messages.untrash"]) {
    assert.deepEqual(await service.invoke({ ...input, operation, input: { id: "msg_1" } }), message);
    assert.equal(requests.at(-1).init.method, "POST");
  }
  state.response = { id: "draft_1", message };
  await service.invoke({ ...input, operation: "drafts.create", input: { raw } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { message: { raw } });
  await service.invoke({ ...input, operation: "drafts.update", input: { id: "draft_1", raw } });
  assert.equal(requests.at(-1).init.method, "PUT");
  assert.equal((await service.invoke({ ...input, operation: "drafts.get", input: { id: "draft_1" } })).message.id, "msg_1");
  state.response = { drafts: [{ id: "draft_1", message }], resultSizeEstimate: 1 };
  assert.equal((await service.invoke({ ...input, operation: "drafts.list" })).drafts[0].id, "draft_1");
  state.response = message;
  await service.invoke({ ...input, operation: "drafts.send", input: { id: "draft_1" } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { id: "draft_1" });
  state.response = { id: "Label_1", name: "Bookings" };
  await service.invoke({ ...input, operation: "labels.create", input: { name: "Bookings" } });
  await service.invoke({ ...input, operation: "labels.update", input: { id: "Label_1", name: "Confirmed" } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { name: "Confirmed" });
  state.response = { labels: [{ id: "Label_1", name: "Confirmed" }] };
  assert.equal((await service.invoke({ ...input, operation: "labels.list" })).labels[0].name, "Confirmed");
  const noContent = createConnectionService({ ...options, fetchImpl: async (url, init) => { requests.push({ url: new URL(url), init }); assert.equal(init.method, "DELETE"); return new Response(null, { status: 204 }); } });
  for (const operation of ["drafts.delete", "labels.delete"]) assert.equal(await noContent.invoke({ ...input, operation, input: { id: "draft_or_label" } }), null);
  const before = requests.length;
  for (const [operation, values] of [["messages.send", { raw: "not MIME + /" }], ["messages.modify", { id: "msg_1" }], ["attachments.get", { messageId: "../other", id: "attachment_1" }]]) await assert.rejects(service.invoke({ ...input, operation, input: values }), { code: "connector_input_invalid" });
  await assert.rejects(service.invoke({ ...input, context: { ...owner, subjectId: "other" }, operation: "messages.read", input: { id: "msg_1" } }));
  assert.equal(requests.length, before);
  for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [503, "connector_provider_failed"]]) {
    state.status = status; const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "messages.send", input: { raw } }), { code });
    assert.equal(requests.length, count + 1);
  }
  state.status = 200;
  await service.disconnect(input);
  state.scopes = ["https://www.googleapis.com/auth/gmail.readonly"];
  state.response = cases.find(entry => entry.provider === gmailProvider).response;
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  const deniedBefore = requests.length;
  for (const [operation, values] of [["messages.send", { raw }], ["drafts.create", { raw }], ["messages.modify", { id: "msg_1", removeLabelIds: ["UNREAD"] }]]) await assert.rejects(service.invoke({ ...input, operation, input: values }), { code: "connector_scope_missing" });
  assert.equal(requests.length, deniedBefore);
  state.response = message;
  assert.deepEqual(await service.invoke({ ...input, operation: "messages.read", input: { id: "msg_1" } }), message);
});


test("Calendar event writes preserve ownership, recurrence, notifications and conditional edits", async t => {
  const provider = { ...googleCalendarProvider, scopes: googleCalendarProvider.scopes.map(s => ({ ...s, recommended: s.recommended || s.value.endsWith("/calendar.events") })) };
  const f = await fixture(t, { provider, response: { kind: "calendar#calendarList", items: [] }, verificationInput: {} });
  await f.service.completeAuthorization({ ...f.input, callbackUrl: (await f.start()).callbackUrl });
  const invoke = (operation, input) => f.service.invoke({ ...f.input, operation, input });
  const event = { summary: "Appointment", start: { dateTime: "2026-10-05T09:00:00+08:00", timeZone: "Australia/Perth" }, end: { dateTime: "2026-10-05T10:00:00+08:00", timeZone: "Australia/Perth" }, recurrence: ["RRULE:FREQ=WEEKLY;COUNT=4"], attendees: [{ email: "customer@example.com" }] };
  f.state.response = { kind: "calendar#event", id: "event-one", etag: '"version1"', ...event };
  const target = { calendarId: "team@example.com", sendUpdates: "all" };
  assert.equal((await invoke("events.create", { ...target, event })).id, "event-one");
  let request = f.requests.at(-1);
  assert.equal(request.init.method, "POST"); assert.equal(request.url.pathname, "/calendar/v3/calendars/team%40example.com/events");
  assert.equal(request.url.searchParams.get("sendUpdates"), "all"); assert.deepEqual(JSON.parse(request.init.body), event);
  assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer test-access-token");
  await invoke("events.get", { calendarId: "team@example.com", eventId: "event-one" });
  await invoke("events.update", { ...target, eventId: "event-one", ifMatch: '"version1"', event: { attendees: [] } });
  request = f.requests.at(-1); assert.equal(request.init.method, "PATCH"); assert.deepEqual(JSON.parse(request.init.body), { attendees: [] });
  assert.equal(new Headers(request.init.headers).get("if-match"), '"version1"');
  const count = f.requests.length;
  for (const input of [{ ...target, event: { ...event, end: event.start } }, { ...target, event: { ...event, start: { dateTime: "2026-10-05T09:00:00" } } }, { ...target, event: { start: { date: "2026-02-30" }, end: { date: "2026-03-02" } } }, { ...target, event: { ...event, recurrence: ["BEGIN:VEVENT"] } }, { event }]) await assert.rejects(invoke("events.create", input));
  assert.equal(f.requests.length, count);
  f.state.response = { kind: "calendar#event", id: "all-day" };
  await invoke("events.create", { ...target, event: { start: { date: "2026-10-05" }, end: { date: "2026-10-06" } } });
  f.state.status = 503;
  const before = f.requests.length;
  await assert.rejects(invoke("events.create", { ...target, event })); assert.equal(f.requests.length, before + 1);
  f.state.status = 204;
  assert.equal(await invoke("events.cancel", { ...target, eventId: "event-one_20261005T010000Z" }), null);
  assert.equal(f.requests.at(-1).init.method, "DELETE");
  await assert.rejects(f.service.invoke({ ...f.input, context: { ...owner, subjectId: "other" }, operation: "events.cancel", input: { ...target, eventId: "event-one" } }), { code: "connector_reconnect_required" });
  await f.service.disconnect(f.input);
  await assert.rejects(invoke("events.get", { eventId: "event-one" }), { code: "connector_reconnect_required" });
  const read = await fixture(t, { provider: googleCalendarProvider, response: { kind: "calendar#calendarList", items: [] }, verificationInput: {} });
  await read.service.completeAuthorization({ ...read.input, callbackUrl: (await read.start()).callbackUrl });
  await assert.rejects(read.service.invoke({ ...read.input, operation: "events.create", input: { ...target, event } }), { code: "connector_scope_missing" });
  assert.equal(read.requests.length, 2);
});


test("Docs create-first access creates and edits without an existing document", async t => {
  const f = await fixture(t, { provider: googleDocsProvider, response: { files: [] }, verificationInput: {} });
  await f.service.completeAuthorization({ ...f.input, callbackUrl: (await f.start()).callbackUrl });
  assert.equal(f.requests[1].url.pathname, "/drive/v3/files");
  assert.equal(f.requests[1].init.method, "GET");
  const invoke = (operation, input) => f.service.invoke({ ...f.input, operation, input });
  f.state.response = { documentId: "new-doc", title: "Notes" };
  const created = await invoke("documents.create", { title: "Notes" });
  assert.equal(created.documentId, "new-doc");
  assert.equal(f.requests.at(-1).url.href, "https://docs.googleapis.com/v1/documents");
  assert.equal(f.requests.at(-1).init.method, "POST");
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { title: "Notes" });
  f.state.response = { documentId: "new-doc", replies: [{}, {}], writeControl: { requiredRevisionId: "rev2" } };
  const requests = [{ insertText: { location: { index: 1, tabId: "tab-one" }, text: "Notes" } }, { updateTextStyle: { range: { startIndex: 1, endIndex: 6, tabId: "tab-one" }, textStyle: { bold: true }, fields: "bold" } }];
  assert.equal((await invoke("documents.batchUpdate", { documentId: "new-doc", requests, requiredRevisionId: "rev1" })).replies.length, 2);
  assert.equal(f.requests.at(-1).url.pathname, "/v1/documents/new-doc:batchUpdate");
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { requests, writeControl: { requiredRevisionId: "rev1" } });
  const before = f.requests.length;
  for (const requests of [[], [{}], [{ insertText: {}, deleteContentRange: {} }], ["insertText"]]) await assert.rejects(invoke("documents.batchUpdate", { documentId: "new-doc", requests }));
  assert.equal(f.requests.length, before);
  f.state.status = 400; f.state.response = { error: { message: "revision conflict" } };
  await assert.rejects(invoke("documents.batchUpdate", { documentId: "new-doc", requests, requiredRevisionId: "old" }));
  assert.equal(f.requests.length, before + 1);
  f.state.status = 503;
  await assert.rejects(invoke("documents.create", { title: "Notes" })); assert.equal(f.requests.length, before + 2);
  const readProvider = { ...googleDocsProvider, scopes: googleDocsProvider.scopes.map(s => ({ ...s, recommended: s.value.endsWith("/documents.readonly") })) };
  const read = await fixture(t, { provider: readProvider, response: { documentId: "old-doc", title: "Read only" }, verificationInput: { documentId: "old-doc" } });
  await read.service.completeAuthorization({ ...read.input, callbackUrl: (await read.start()).callbackUrl });
  assert.equal(read.requests[1].url.pathname, "/v1/documents/old-doc");
  await assert.rejects(read.service.invoke({ ...read.input, operation: "documents.create", input: { title: "Denied" } }), { code: "connector_scope_missing" });
  assert.equal(read.requests.length, 2);
});


test("Drive transfers preserve bytes and scope boundaries with bounded native multipart", async t => {
  const f = await fixture(t, { provider: googleDriveProvider, response: { kind: "drive#fileList", files: [] }, verificationInput: {} });
  await f.service.completeAuthorization({ ...f.input, callbackUrl: (await f.start()).callbackUrl });
  const invoke = (operation, input) => f.service.invoke({ ...f.input, operation, input });
  f.state.response = { id: "uploaded", name: "Report.pdf" };
  const bytes = Buffer.from([0, 255, 8, 13, 10]);
  await invoke("files.upload", { name: "Report.pdf", parentId: "folder-one", contentType: "application/pdf", bodyBase64: bytes.toString("base64") });
  let request = f.requests.at(-1);
  assert.equal(request.url.pathname, "/upload/drive/v3/files"); assert.equal(request.url.searchParams.get("uploadType"), "multipart");
  assert.equal(request.init.method, "POST"); assert.equal(request.init.redirect, "error");
  assert.match(new Headers(request.init.headers).get("content-type"), /^multipart\/related; boundary=drive_/);
  assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer test-access-token");
  assert(Buffer.from(request.init.body).includes(bytes));
  assert(Buffer.from(request.init.body).includes(Buffer.from('"parents":["folder-one"]')));
  await invoke("files.upload", { fileId: "uploaded", name: "Changed.pdf", contentType: "application/pdf", bodyBase64: bytes.toString("base64") });
  assert.equal(f.requests.at(-1).init.method, "PATCH");
  await invoke("files.create", { name: "Reports", folder: true });
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { name: "Reports", mimeType: "application/vnd.google-apps.folder" });
  await invoke("files.update", { fileId: "uploaded", trashed: true });
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { trashed: true });
  f.state.bytes = bytes;
  const downloaded = await invoke("files.download", { fileId: "uploaded" });
  assert.deepEqual(downloaded, { bodyBase64: bytes.toString("base64"), size: bytes.length, contentType: "application/pdf" });
  await invoke("files.export", { fileId: "document", mimeType: "application/pdf" });
  assert.equal(f.requests.at(-1).url.pathname, "/drive/v3/files/document/export");
  assert.equal(f.requests.at(-1).url.searchParams.get("mimeType"), "application/pdf");
  f.state.bytes = new Uint8Array(8 * 1024 * 1024 + 1);
  await assert.rejects(invoke("files.download", { fileId: "uploaded" }), { code: "connector_response_too_large" });
  delete f.state.bytes;
  const before = f.requests.length;
  for (const input of [{ fileId: "https://evil.test" }, { fileId: "../other" }]) await assert.rejects(invoke("files.download", input));
  await assert.rejects(invoke("files.upload", { name: "Bad", contentType: "text/plain\r\nX: evil", bodyBase64: "aGVsbG8=" }));
  await assert.rejects(invoke("files.upload", { name: "Bad", contentType: "text/plain", bodyBase64: "not base64" }));
  assert.equal(f.requests.length, before);
  f.state.status = 403;
  await assert.rejects(invoke("files.download", { fileId: "uploaded" }), { code: "connector_permission_denied" });
  f.state.status = 503;
  await assert.rejects(invoke("files.upload", { name: "Retry?", contentType: "text/plain", bodyBase64: "aGVsbG8=" }));
  assert.equal(f.requests.length, before + 2);
  await assert.rejects(f.service.invoke({ ...f.input, context: { ...owner, subjectId: "other" }, operation: "files.download", input: { fileId: "uploaded" } }), { code: "connector_reconnect_required" });  f.state.status = 200; f.state.response = { kind: "drive#fileList", files: [] }; f.state.scopes = ["https://www.googleapis.com/auth/drive.readonly"];
  await f.service.completeAuthorization({ ...f.input, callbackUrl: (await f.start()).callbackUrl });
  const grantedCount = f.requests.length;
  await assert.rejects(invoke("files.upload", { name: "No write grant", contentType: "text/plain", bodyBase64: "aGVsbG8=" }), { code: "connector_scope_missing" });
  assert.equal(f.requests.length, grantedCount);
});


test("Search Console queries performance and manages sitemap entries without claiming site ownership", async t => {
  const provider = { ...googleSearchConsoleProvider, scopes: googleSearchConsoleProvider.scopes.map(s => ({ ...s, recommended: s.recommended || s.value.endsWith("/webmasters") })) };
  const f = await fixture(t, { provider, response: { siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] }, verificationInput: {} });
  await f.service.completeAuthorization({ ...f.input, callbackUrl: (await f.start()).callbackUrl });
  const invoke = (operation, input) => f.service.invoke({ ...f.input, operation, input });
  const siteUrl = "sc-domain:example.com";
  f.state.response = { rows: [{ keys: ["grooming"], clicks: 3, impressions: 20, ctr: 0.15, position: 2 }], responseAggregationType: "byProperty" };
  const query = { siteUrl, startDate: "2026-09-01", endDate: "2026-09-10", dimensions: ["query"], filters: [{ dimension: "device", operator: "equals", expression: "MOBILE" }], startRow: 25000, rowLimit: 25000 };
  assert.equal((await invoke("searchAnalytics.query", query)).rows[0].clicks, 3);
  let request = f.requests.at(-1);
  assert.equal(request.url.pathname, "/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query");
  const body = JSON.parse(request.init.body); assert.equal(body.startRow, 25000); assert.equal(body.dataState, "final");
  assert.deepEqual(body.dimensionFilterGroups, [{ groupType: "and", filters: query.filters }]);
  f.state.response = {}; assert.deepEqual(await invoke("searchAnalytics.query", query), {});
  f.state.response = { inspectionResult: { indexStatusResult: { verdict: "PASS", lastCrawlTime: "2026-09-01T00:00:00Z" } } };
  await invoke("urlInspection.inspect", { siteUrl, inspectionUrl: "https://example.com/book" });
  assert.equal(f.requests.at(-1).url.pathname, "/v1/urlInspection/index:inspect");
  f.state.response = { sitemap: [{ path: "https://example.com/sitemap.xml", isPending: true }] };
  await invoke("sitemaps.list", { siteUrl });
  const feedpath = "https://example.com/sitemap.xml";
  f.state.status = 204;
  assert.equal(await invoke("sitemaps.submit", { siteUrl, feedpath }), null);
  request = f.requests.at(-1); assert.equal(request.init.method, "PUT"); assert(request.url.pathname.endsWith("https%3A%2F%2Fexample.com%2Fsitemap.xml"));
  assert.equal(await invoke("sitemaps.delete", { siteUrl, feedpath }), null);
  assert.equal(f.requests.at(-1).init.method, "DELETE");
  const before = f.requests.length;
  await assert.rejects(invoke("searchAnalytics.query", { ...query, endDate: "2026-08-01" }));
  await assert.rejects(invoke("searchAnalytics.query", { ...query, startDate: "2026-02-30" }));
  await assert.rejects(invoke("searchAnalytics.query", { ...query, dimensions: ["query", "query"] }));
  await assert.rejects(invoke("sitemaps.submit", { siteUrl, feedpath: "file:///etc/passwd" }));
  assert.equal(f.requests.length, before);
  f.state.status = 403; f.state.response = { error: {} };
  await assert.rejects(invoke("sitemaps.submit", { siteUrl, feedpath }), { code: "connector_permission_denied" });
  const read = await fixture(t, { provider: googleSearchConsoleProvider, response: { siteEntry: [] }, verificationInput: {} });
  await read.service.completeAuthorization({ ...read.input, callbackUrl: (await read.start()).callbackUrl });
  await assert.rejects(read.service.invoke({ ...read.input, operation: "sitemaps.submit", input: { siteUrl, feedpath } }), { code: "connector_scope_missing" });
  assert.equal(read.requests.length, 2);
});

test("Sheets creates files and writes ranges with explicit formula parsing and no uncertain append retry", async t => {
  const f = await fixture(t, { provider: googleSheetsProvider, response: { files: [] }, verificationInput: {} });
  await f.service.completeAuthorization({ ...f.input, callbackUrl: (await f.start()).callbackUrl });
  assert.equal(f.requests[1].url.pathname, "/drive/v3/files");
  const invoke = (operation, input) => f.service.invoke({ ...f.input, operation, input });
  const spreadsheetId = "new-sheet", range = "'A & B'!A1:B2";
  f.state.response = { spreadsheetId, properties: { title: "Bookings" } };
  await invoke("spreadsheets.create", { title: "Bookings" });
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { properties: { title: "Bookings" } });
  f.state.response = { spreadsheetId, updatedRange: range, updatedCells: 4 };
  await invoke("values.update", { spreadsheetId, range, values: [["=1+1", 12], [null, ""]] });
  let request = f.requests.at(-1);
  assert.equal(request.init.method, "PUT"); assert.equal(request.url.searchParams.get("valueInputOption"), "RAW");
  assert.equal(decodeURIComponent(request.url.pathname), `/v4/spreadsheets/${spreadsheetId}/values/${range}`);
  assert.deepEqual(JSON.parse(request.init.body).values, [["=1+1", 12], [null, ""]]);
  await invoke("values.update", { spreadsheetId, range, values: [["=SUM(B1:B2)"]], valueInputOption: "USER_ENTERED" });
  assert.equal(f.requests.at(-1).url.searchParams.get("valueInputOption"), "USER_ENTERED");
  f.state.response = { spreadsheetId, updates: { spreadsheetId, updatedRange: "'A & B'!A3:B3" } };
  await invoke("values.append", { spreadsheetId, range, values: [["Customer", 40]] });
  assert.equal(f.requests.at(-1).url.searchParams.get("insertDataOption"), "INSERT_ROWS");
  f.state.response = { spreadsheetId, clearedRange: range };
  await invoke("values.clear", { spreadsheetId, range });
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), {});
  f.state.response = { spreadsheetId, responses: [{ updatedRange: range }] };
  await invoke("values.batchUpdate", { spreadsheetId, data: [{ range, values: [[true, 40]] }] });
  assert.equal(f.requests.at(-1).url.pathname, "/v4/spreadsheets/new-sheet/values:batchUpdate");
  assert.equal(JSON.parse(f.requests.at(-1).init.body).data[0].majorDimension, "ROWS");
  f.state.response = { spreadsheetId, replies: [{ addSheet: { properties: { sheetId: 12 } } }] };
  const requests = [{ addSheet: { properties: { title: "Totals" } } }];
  await invoke("spreadsheets.batchUpdate", { spreadsheetId, requests });
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { requests });
  f.state.response = { range, values: [["=SUM(B1:B2)"]] };
  await invoke("values.get", { spreadsheetId, range, valueRenderOption: "FORMULA" });
  assert.equal(f.requests.at(-1).url.searchParams.get("valueRenderOption"), "FORMULA");
  const before = f.requests.length;
  for (const values of [[], ["bad row"], [[{}]], [[Infinity]], [Array(10001).fill(1)]]) await assert.rejects(invoke("values.update", { spreadsheetId, range, values }));
  await assert.rejects(invoke("values.batchUpdate", { spreadsheetId, data: [] }));
  await assert.rejects(invoke("spreadsheets.batchUpdate", { spreadsheetId, requests: [{ addSheet: {}, deleteSheet: {} }] }));
  assert.equal(f.requests.length, before);
  f.state.status = 503; f.state.response = { error: {} };
  await assert.rejects(invoke("values.append", { spreadsheetId, range, values: [["Uncertain", 40]] }));
  assert.equal(f.requests.length, before + 1);
  const readProvider = { ...googleSheetsProvider, scopes: googleSheetsProvider.scopes.map(scope => ({ ...scope, recommended: scope.value.endsWith("/spreadsheets.readonly") })) };
  const read = await fixture(t, { provider: readProvider, response: { spreadsheetId, properties: { title: "Read only" } }, verificationInput: { spreadsheetId } });
  await read.service.completeAuthorization({ ...read.input, callbackUrl: (await read.start()).callbackUrl });
  await assert.rejects(read.service.invoke({ ...read.input, operation: "values.update", input: { spreadsheetId, range, values: [["Denied"]] } }), { code: "connector_scope_missing" });
  assert.equal(read.requests.length, 2);
});

test("Slides creates first, edits with revision control and retrieves temporary thumbnails", async t => {
  const f = await fixture(t, { provider: googleSlidesProvider, response: { files: [] }, verificationInput: {} });
  await f.service.completeAuthorization({ ...f.input, callbackUrl: (await f.start()).callbackUrl });
  assert.equal(f.requests[1].url.pathname, "/drive/v3/files");
  const invoke = (operation, input) => f.service.invoke({ ...f.input, operation, input });
  const presentationId = "deck-one";
  f.state.response = { presentationId, title: "Bookings" };
  await invoke("presentations.create", { title: "Bookings" });
  assert.equal(f.requests.at(-1).url.pathname, "/v1/presentations");
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { title: "Bookings" });
  const requests = [{ createSlide: { objectId: "booking_slide", slideLayoutReference: { predefinedLayout: "BLANK" } } }, { insertText: { objectId: "existing_title", text: "Bookings" } }];
  f.state.response = { presentationId, replies: [{ createSlide: { objectId: "booking_slide" } }, {}] };
  await invoke("presentations.batchUpdate", { presentationId, requests, requiredRevisionId: "rev-one" });
  assert.equal(f.requests.at(-1).url.pathname, "/v1/presentations/deck-one:batchUpdate");
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { requests, writeControl: { requiredRevisionId: "rev-one" } });
  f.state.response = { objectId: "slide:one", pageElements: [] };
  await invoke("pages.get", { presentationId, pageObjectId: "slide:one" });
  assert.equal(f.requests.at(-1).url.pathname, "/v1/presentations/deck-one/pages/slide%3Aone");
  f.state.response = { contentUrl: "https://images.example/temporary", width: 800, height: 450 };
  assert.equal((await invoke("pages.getThumbnail", { presentationId, pageObjectId: "slide:one", size: "LARGE" })).width, 800);
  assert.equal(f.requests.at(-1).url.searchParams.get("thumbnailProperties.thumbnailSize"), "LARGE");
  const before = f.requests.length;
  for (const requests of [[], [{}], [{ createSlide: {}, deleteObject: {} }]]) await assert.rejects(invoke("presentations.batchUpdate", { presentationId, requests }));
  await assert.rejects(invoke("pages.get", { presentationId, pageObjectId: "../other" }));
  assert.equal(f.requests.length, before);
  f.state.response = { contentUrl: "javascript:alert(1)", width: 800, height: 450 };
  await assert.rejects(invoke("pages.getThumbnail", { presentationId, pageObjectId: "slide:one" }), { code: "connector_response_invalid" });
  f.state.status = 400; f.state.response = { error: { message: "stale revision" } };
  await assert.rejects(invoke("presentations.batchUpdate", { presentationId, requests, requiredRevisionId: "old" }));
  f.state.status = 503;
  await assert.rejects(invoke("presentations.create", { title: "Uncertain" }));
  assert.equal(f.requests.length, before + 3);
  const provider = { ...googleSlidesProvider, scopes: googleSlidesProvider.scopes.map(scope => ({ ...scope, recommended: scope.value.endsWith("/presentations.readonly") })) };
  const read = await fixture(t, { provider, response: { presentationId, title: "Read only" }, verificationInput: { presentationId } });
  await read.service.completeAuthorization({ ...read.input, callbackUrl: (await read.start()).callbackUrl });
  await assert.rejects(read.service.invoke({ ...read.input, operation: "presentations.create", input: { title: "Denied" } }), { code: "connector_scope_missing" });
  assert.equal(read.requests.length, 2);
});
