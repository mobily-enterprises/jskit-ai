import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService, ConnectorError } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { semrushProvider } from "../src/server/semrush.js";

const context = { applicationId: "seo-app", subjectId: "marketing-team" };
const input = { context, integrationId: "seo" };
const project = {
  project_id: 643526670283248, project_name: "Website", domain: "example.test", domain_unicode: "example.test", owner_id: 123456780,
  permissions: { read: true, edit: false, delete: false, share: false, downgraded: false }, tools: [{ name: "site_audit" }]
};
const meta = { request_id: "fixture-request", status_code: 200, success: true };
const page = { meta: { ...meta, scope: "OWN", limit: 100, offset: 0, total_count: 1 }, data: [project] };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "semrush-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current" });
  const requests = [];
  const state = { key: "fixture-v4-key", status: 200, response: page, wait: false, resolutions: 0 };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { seo: {
      provider: "semrush", displayName: "Marketing projects", accountMode: "shared", scopes: [],
      authentication: { method: "api-key", secretRef: "env:SEMRUSH_V4_KEY" }, extensions: { fromCli: true }
    } }, extensions: { preserved: true } },
    providers: [semrushProvider], authorize: async (owner) => owner,
    store: createFileConnectionStore({ directory, protection }),
    resolveReference: async (ref) => { state.resolutions++; assert.equal(ref, "env:SEMRUSH_V4_KEY"); return state.key; },
    fetchImpl: async (address, init) => {
      requests.push({ url: new URL(String(address)), init, headers: new Headers(init.headers) });
      if (state.wait) {
        return new Promise((_, reject) => {
          if (init.signal.aborted) reject(init.signal.reason);
          else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        });
      }
      return Response.json(state.response, { status: state.status });
    }
  };
  return { service: createConnectionService(options), options, requests, directory, protection, state };
}

test("Semrush V4 verifies Projects access, stores no raw key and preserves ownership through restart and rotation", async (t) => {
  const { service, options, requests, directory, protection, state } = await fixture(t);
  const connected = await service.connectApiKey(input);
  assert.equal(connected.status, "connected");
  assert.equal(requests[0].url.href, "https://api.semrush.com/apis/v4/projects/v1/projects?scope=OWN&limit=100&offset=0");
  assert.equal(requests[0].init.method, "GET"); assert.equal(requests[0].init.body, undefined);
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].headers.get("authorization"), `Apikey ${state.key}`);
  assert.equal(requests[0].headers.get("accept"), "application/json");
  for (const name of await readdir(directory)) {
    const stored = await readFile(path.join(directory, name), "utf8");
    assert.doesNotThrow(() => JSON.parse(stored)); assert.equal(stored.includes(state.key), false);
  }
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.status(input), connected);
  state.key = "rotated-v4-key";
  assert.deepEqual(await restarted.invoke({ ...input, operation: "projects.list" }), page);
  assert.equal(requests.at(-1).headers.get("authorization"), "Apikey rotated-v4-key");
  for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-team" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "projects.list" }), { code: "connector_reconnect_required" });
  }
  assert.equal(requests.length, 2);
  await restarted.disconnect(input);
  assert.equal((await service.status(input)).status, "disconnected");
});

test("Semrush configuration requires a key reference and keeps shared/assistant ownership separate from OAuth", async (t) => {
  const { service, options, state, requests } = await fixture(t);
  const parse = (configuration) => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [semrushProvider] });
  const parsed = parse(options.configuration);
  assert.deepEqual(parsed.extensions, { preserved: true });
  assert.deepEqual(parsed.integrations.seo.extensions, { fromCli: true });
  for (const accountMode of ["shared", "assistant"]) {
    const configuration = structuredClone(options.configuration); configuration.integrations.seo.accountMode = accountMode;
    assert.equal(parse(configuration).integrations.seo.accountMode, accountMode);
  }
  for (const change of [
    { authentication: { method: "api-key", secretRef: "raw-v4-key" } },
    { authentication: { method: "api-key", secretRef: "https://example.test/key" } },
    { authentication: { method: "api-key" } }, { accountMode: "per-user" },
    { authentication: { method: "oauth2", registrationRef: "semrush" } }, { scopes: ["user.id"] }
  ]) {
    const configuration = structuredClone(options.configuration); Object.assign(configuration.integrations.seo, change);
    assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors));
  }
  for (const key of ["", "key with spaces", "key\nheader", "key\u0000"]) {
    state.key = key;
    await assert.rejects(service.connectApiKey(input), { code: "connector_binding_missing" });
  }
  assert.equal(requests.length, 0);
});

test("Semrush list scopes, pagination and empty pages remain explicit without automatic fetching", async (t) => {
  const { service, state, requests } = await fixture(t);
  await service.connectApiKey(input);
  for (const scope of ["OWN", "ALL", "SHARED", "CORPORATE"]) {
    state.response = { meta: { ...meta, scope, limit: 1000, offset: 5, total_count: 6 }, data: [project] };
    assert.deepEqual(await service.invoke({ ...input, operation: "projects.list", input: { scope, limit: 1000, offset: 5 } }), state.response);
    assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { scope, limit: "1000", offset: "5" });
  }
  const count = requests.length;
  for (const values of [{ limit: 0 }, { limit: 1001 }, { limit: 1.5 }, { offset: -1 }, { offset: Number.MAX_SAFE_INTEGER + 1 }, { scope: "other" }, { url: "https://other.test" }, { key: "other-key" }, { headers: { Authorization: "other" } }]) {
    await assert.rejects(service.invoke({ ...input, operation: "projects.list", input: values }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.response = { meta: { ...page.meta, total_count: 0 }, data: [] };
  assert.deepEqual(await service.invoke({ ...input, operation: "projects.list" }), state.response);
  assert.equal(requests.length, count + 1);
});

test("Semrush project reads bind a safe numeric ID to both the request and result", async (t) => {
  const { service, requests, state } = await fixture(t);
  await service.connectApiKey(input);
  state.response = { meta, data: project };
  assert.deepEqual(await service.invoke({ ...input, operation: "projects.get", input: { projectId: project.project_id } }), state.response);
  assert.equal(requests.at(-1).url.href, `https://api.semrush.com/apis/v4/projects/v1/projects/${project.project_id}`);
  for (const projectId of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "../other", "https://other.test", "12?key=other"]) {
    await assert.rejects(service.invoke({ ...input, operation: "projects.get", input: { projectId } }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, 2);
  state.response = { meta, data: { ...project, project_id: project.project_id + 1 } };
  await assert.rejects(service.invoke({ ...input, operation: "projects.get", input: { projectId: project.project_id } }), { code: "connector_response_invalid" });
});

test("Semrush rejects malformed envelopes, pagination, project permissions and unsafe IDs", async (t) => {
  const { service, state } = await fixture(t);
  await service.connectApiKey(input);
  for (const response of [
    {}, { ...page, meta: { ...page.meta, success: "true" } }, { ...page, error: {} },
    { ...page, meta: { ...page.meta, status_code: 201 } }, { ...page, meta: { ...page.meta, request_id: "" } },
    { ...page, meta: { ...page.meta, scope: "ALL" } }, { ...page, meta: { ...page.meta, offset: 1 } },
    { ...page, meta: { ...page.meta, limit: 2 } }, { ...page, meta: { ...page.meta, total_count: 0 } },
    { ...page, meta: { ...page.meta, total_count: 1.5 } }, { ...page, data: {} },
    { ...page, meta: { ...page.meta, total_count: 101 }, data: Array(101).fill(project) },
    ...[{ project_id: Number.MAX_SAFE_INTEGER + 1 }, { project_id: "12" }, { owner_id: 0 }, { project_name: "" },
      { domain: null }, { permissions: { ...project.permissions, read: "true" } }, { tools: [{}] }]
      .map((change) => ({ ...page, data: [{ ...project, ...change }] }))
  ]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation: "projects.list" }), { code: "connector_response_invalid" });
  }
});

test("Semrush HTTP-200 error codes distinguish revoked keys, entitlement, capacity and missing projects without leaking messages", async (t) => {
  const { service, state, requests } = await fixture(t);
  for (const [providerCode, code] of [
    [70, "connector_reconnect_required"], [120, "connector_reconnect_required"], [121, "connector_reconnect_required"], [122, "connector_reconnect_required"],
    [130, "connector_permission_denied"], [131, "connector_quota_limited"], [132, "connector_quota_limited"], [134, "connector_quota_limited"],
    [512, "connector_resource_not_found"], [511, "connector_provider_failed"], [999, "connector_provider_failed"]
  ]) {
    state.response = { meta: { ...meta, success: false }, error: { code: providerCode, message: state.key } };
    const count = requests.length;
    await assert.rejects(service.connectApiKey(input), (error) => {
      assert.equal(error.code, code); assert.equal(error.message.includes(state.key), false);
      assert.equal(JSON.stringify(error).includes(state.key), false); return true;
    });
    assert.equal(requests.length, count + 1); assert.equal((await service.status(input)).status, "disconnected");
  }
  state.response = page; await service.connectApiKey(input);
  state.response = { meta: { ...meta, success: false }, error: { code: 70, message: state.key } };
  await assert.rejects(service.invoke({ ...input, operation: "projects.list" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Semrush transport failures do not retry or verify the connection, and authorization precedes key resolution", async (t) => {
  const { service, options, state, requests } = await fixture(t);
  for (const [status, code] of [[401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status; state.response = { message: state.key };
    const count = requests.length;
    await assert.rejects(service.connectApiKey(input), (error) => error.code === code && !error.message.includes(state.key));
    assert.equal(requests.length, count + 1);
  }
  state.status = 200; state.response = page; await service.connectApiKey(input);
  const denied = createConnectionService({ ...options, authorize: async () => { throw new ConnectorError("connector_permission_denied", "Denied", { statusCode: 403 }); } });
  const count = requests.length, resolutions = state.resolutions;
  await assert.rejects(denied.invoke({ ...input, operation: "projects.get", input: { projectId: project.project_id } }), { code: "connector_permission_denied" });
  assert.equal(requests.length, count); assert.equal(state.resolutions, resolutions);
});

test("Semrush interruption and timeout leave the stored connection usable without replaying reads", async (t) => {
  const { service, options, state, requests } = await fixture(t);
  await service.connectApiKey(input); state.wait = true;
  const controller = new AbortController();
  const pending = service.invoke({ ...input, operation: "projects.list", signal: controller.signal });
  setTimeout(() => controller.abort(), 15);
  await assert.rejects(pending, { code: "connector_cancelled" });
  const timeoutService = createConnectionService({ ...options, providers: [{ ...semrushProvider, requestTimeoutMs: 20 }] });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(timeoutService.invoke({ ...input, operation: "projects.list" }), { code: "connector_provider_timeout" }); }
  finally { clearTimeout(keepAlive); }
  assert.equal(requests.length, 3);
  assert.equal((await service.status(input)).status, "connected");
  state.wait = false;
  assert.deepEqual(await service.invoke({ ...input, operation: "projects.list" }), page);
});

test("Semrush creates and renames projects without replaying uncertain writes", async (t) => {
  const { service, options, state, requests } = await fixture(t);
  await service.connectApiKey(input);
  const before = requests.length;
  for (const fields of [{ domain: "https://example.test", project_name: "Website" },
    { domain: "example.test", project_name: "Bad/name" }, { domain: "example.test", project_name: "" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "projects.create", input: fields }));
  }
  await assert.rejects(service.invoke({ ...input, operation: "projects.update", input: { projectId: project.project_id } }));
  assert.equal(requests.length, before);
  const denied = createConnectionService({ ...options, authorize: async (owner, request) => request.operation === "projects.create" ? null : owner });
  const resolutions = state.resolutions;
  await assert.rejects(denied.invoke({ ...input, operation: "projects.create", input: { domain: "example.test", project_name: "Website" } }), { code: "connector_access_denied" });
  assert.equal(requests.length, before); assert.equal(state.resolutions, resolutions);
  state.status = 201;
  state.response = { meta: { ...meta, status_code: 201 }, data: { ...project, tools: [] } };
  assert.deepEqual(await service.invoke({ ...input, operation: "projects.create", input: { domain: "example.test", project_name: "Website" } }), state.response);
  assert.equal(requests.at(-1).init.method, "POST");
  assert.equal(requests.at(-1).url.pathname, "/apis/v4/projects/v1/projects");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { domain: "example.test", project_name: "Website" });
  state.status = 200;
  state.response = { meta, data: { ...project, project_name: "New name" } };
  assert.deepEqual(await service.invoke({ ...input, operation: "projects.update", input: { projectId: project.project_id, project_name: "New name" } }), state.response);
  assert.equal(requests.at(-1).init.method, "PATCH");
  assert.equal(requests.at(-1).url.pathname, `/apis/v4/projects/v1/projects/${project.project_id}`);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { project_name: "New name" });
  const write = { ...input, operation: "projects.update", input: { projectId: project.project_id, project_name: "Uncertain name" } };
  const priorFailure = requests.length;
  await assert.rejects(service.invoke(write), { code: "connector_response_invalid" });
  assert.equal(requests.length, priorFailure + 1);
  state.status = 500;
  await assert.rejects(service.invoke(write), { code: "connector_provider_failed" });
  assert.equal(requests.length, priorFailure + 2);
});


test("Semrush deletion validates the exact project and never retries an uncertain removal", async (t) => {
  const { service, options, state, requests } = await fixture(t);
  await service.connectApiKey(input);
  const deletion = { ...input, operation: "projects.delete", input: { projectId: project.project_id } };
  const before = requests.length, resolutions = state.resolutions;
  const denied = createConnectionService({ ...options, authorize: async () => null });
  await assert.rejects(denied.invoke(deletion), { code: "connector_access_denied" });
  assert.equal(state.resolutions, resolutions);
  for (const projectId of [0, -1, "not-an-id", Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(service.invoke({ ...deletion, input: { projectId } }));
  }
  assert.equal(requests.length, before);
  state.response = { meta, data: { project_id: project.project_id } };
  assert.deepEqual(await service.invoke(deletion), state.response);
  assert.equal(requests.at(-1).init.method, "DELETE");
  assert.equal(requests.at(-1).url.pathname, `/apis/v4/projects/v1/projects/${project.project_id}`);
  assert.equal(requests.at(-1).init.body, undefined);
  for (const data of [{}, { project_id: project.project_id + 1 }, { project_id: String(project.project_id) }]) {
    state.response = { meta, data };
    const count = requests.length;
    await assert.rejects(service.invoke(deletion), { code: "connector_response_invalid" });
    assert.equal(requests.length, count + 1);
  }
  state.status = 500;
  const count = requests.length;
  await assert.rejects(service.invoke(deletion), { code: "connector_provider_failed" });
  assert.equal(requests.length, count + 1);
  assert.equal((await service.status(input)).status, "connected");
});


test("Semrush keyword metrics preserve numeric strings and reject mismatched reports without automatic fetching", async (t) => {
  const { service, state, requests } = await fixture(t);
  await service.connectApiKey(input);
  const report = { ...input, operation: "keywords.metrics", input: { keyword: "seo & tools", country: "US", month: "2024-01" } };
  const data = { competitive_density: 78, cpc: "1245", intents: ["COMMERCIAL"], keyword_difficulty: 74,
    number_of_results: "9007199254740993", search_volume: "60500", serp_features: ["AI_OVERVIEW"], trends: [82, 78] };
  state.response = { meta: { ...meta, keyword: "seo & tools", country: "US", month: "2024-01" }, data };
  assert.deepEqual(await service.invoke(report), state.response);
  assert.equal(requests.length, 2);
  const url = requests.at(-1).url;
  assert.equal(url.pathname, "/apis/v4/keywords/v1/metrics");
  assert.equal(url.searchParams.get("keyword"), "seo & tools");
  assert.equal(url.searchParams.get("format"), "json");
  assert.equal(url.searchParams.has("key"), false);
  const before = requests.length;
  for (const fields of [{ month: "2011-12" }, { month: "9999-01" }, { month: "2024-13" }, { country: "USA" }, { keyword: "" }]) {
    await assert.rejects(service.invoke({ ...report, input: { ...report.input, ...fields } }));
  }
  assert.equal(requests.length, before);
  const original = state.response;
  for (const response of [ { ...original, meta: { ...original.meta, country: "AU" } },
    { ...original, meta: { ...original.meta, month: "2024-02" } },
    { ...original, data: { ...data, search_volume: 60500 } }, { ...original, data: null } ]) {
    state.response = response;
    const count = requests.length;
    await assert.rejects(service.invoke(report), { code: "connector_response_invalid" });
    assert.equal(requests.length, count + 1);
  }
});


test("Semrush backlink reports use bounded explicit pages and never fetch target websites", async (t) => {
  const { service, state, requests } = await fixture(t);
  await service.connectApiKey(input);
  const target = { url: "https://example.test/resources?a=1&b=2", scope: "SUBFOLDER" };
  const reports = [
    ["backlinks.list", "links", { source_url: "https://source.test", target_url: target.url, anchor: "Visit", is_nofollow: false }],
    ["backlinks.referringDomains", "ref-domains", { domain: "source.test", backlinks_count: 3, domain_score: 20 }],
    ["backlinks.anchors", "anchors", { anchor: "", backlinks_count: 3, domains_count: 1 }]
  ];
  for (const [operation, endpoint, row] of reports) {
    const call = { ...input, operation, input: { ...target, limit: 2, offset: 4, direction: "ASC", filter: "is_new = true" } };
    state.response = { meta: { ...meta, limit: "2", offset: 4, total: 7, scope: "SUBFOLDER" }, data: [row] };
    const before = requests.length;
    assert.deepEqual(await service.invoke(call), state.response);
    assert.equal(requests.length, before + 1);
    const request = requests.at(-1);
    assert.equal(request.url.origin, "https://api.semrush.com");
    assert.equal(request.url.pathname, `/apis/v4/backlinks/v1/${endpoint}`);
    assert.equal(request.url.searchParams.get("url"), target.url);
    assert.equal(request.url.searchParams.get("filter"), "is_new = true");
    assert.equal(request.url.searchParams.get("offset"), "4");
    assert.equal(request.url.searchParams.get("format"), "json");
    assert.equal(request.headers.get("authorization"), `Apikey ${state.key}`);
    state.response = { meta, data: [] };
    assert.deepEqual((await service.invoke(call)).data, []);
    for (const response of [{ meta, data: [{}] }, { meta, data: [row, row, row] },
      { meta: { ...meta, offset: 0 }, data: [row] }, { meta: { ...meta, scope: "PAGE" }, data: [row] }]) {
      state.response = response;
      await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
    }
    const count = requests.length;
    for (const fields of [{ limit: 1001 }, { offset: -1 }, { scope: "ALL" }, { format: "csv" }, { url: "" }]) {
      await assert.rejects(service.invoke({ ...call, input: { ...call.input, ...fields } }));
    }
    assert.equal(requests.length, count);
  }
  state.response = { meta, data: { backlinks_count: 3, domains_count: 1, urls_count: 2, score: 20 } };
  assert.deepEqual(await service.invoke({ ...input, operation: "backlinks.overview", input: target }), state.response);
  assert.equal(requests.at(-1).url.pathname, "/apis/v4/backlinks/v1/overview");
  state.response.data.score = "20";
  await assert.rejects(service.invoke({ ...input, operation: "backlinks.overview", input: target }), { code: "connector_response_invalid" });
});


test("Semrush V3 domain reports use a separate private key and decode provider CSV", async (t) => {
  const { options, requests } = await fixture(t);
  options.configuration.integrations.seo.settings = { v3ApiKeyRef: "env:SEMRUSH_V3_KEY" };
  const originalFetch = options.fetchImpl, originalResolve = options.resolveReference;
  let csv = '"Domain";"Rank";"Organic Keywords";"Organic Traffic";"Organic Cost";"Adwords Keywords";"Adwords Traffic";"Adwords Cost"\r\n"example.test";"42";"9007199254740993";"20";"1.25";"0";"0";"0"\r\n';
  options.resolveReference = async (ref) => ref === "env:SEMRUSH_V3_KEY" ? "private-v3-key" : originalResolve(ref);
  options.fetchImpl = async (address, init) => {
    if (new URL(address).pathname !== "/") return originalFetch(address, init);
    requests.push({ url: new URL(address), init, headers: new Headers(init.headers) });
    return new Response(csv, { headers: { "content-type": "text/csv" } });
  };
  const service = createConnectionService(options);
  await service.connectApiKey(input);
  const call = { ...input, operation: "domains.overview", input: { domain: "example.test", database: "us" } };
  const report = await service.invoke(call);
  assert.equal(report.rows[0][2], "9007199254740993");
  assert.equal(report.rows[0][4], "1.25");
  assert.equal(requests.length, 2);
  assert.equal(requests.at(-1).url.origin, "https://api.semrush.com");
  assert.equal(requests.at(-1).url.searchParams.get("key"), "private-v3-key");
  assert.equal(requests.at(-1).url.searchParams.get("type"), "domain_rank");
  assert.equal(requests.at(-1).headers.has("authorization"), false);
  assert.equal(requests.at(-1).init.redirect, "error");
  csv = 'ERROR 50 :: NOTHING FOUND';
  assert.deepEqual((await service.invoke(call)).rows, []);
  for (const bad of ['"Domain";"Rank"\nexample.test;1', '"unterminated', '"Domain"oops;Rank']) {
    csv = bad;
    await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
  }
  for (const [providerCode, expected] of [[110, "connector_binding_missing"], [120, "connector_binding_missing"],
    [130, "connector_permission_denied"], [133, "connector_permission_denied"], [135, "connector_permission_denied"],
    [131, "connector_quota_limited"], [132, "connector_quota_limited"], [134, "connector_quota_limited"]]) {
    csv = `ERROR ${providerCode} :: private-v3-key`;
    await assert.rejects(service.invoke(call), (error) => error.code === expected && !error.message.includes("private-v3-key"));
  }
  assert.equal((await service.status(input)).status, "connected");
  const denied = createConnectionService({ ...options, authorize: async () => null,
    resolveReference: async () => { throw new Error("Must not resolve a denied caller's key"); } });
  const before = requests.length;
  await assert.rejects(denied.invoke(call), { code: "connector_access_denied" });
  assert.equal(requests.length, before);
});


test("Semrush keyword detail pages translate offsets and decode quoted organic/paid rows", async (t) => {
  const { options, requests } = await fixture(t);
  options.configuration.integrations.seo.settings = { v3ApiKeyRef: "env:SEMRUSH_V3_KEY" };
  const originalFetch = options.fetchImpl, originalResolve = options.resolveReference;
  const header = 'Keyword;Position;Search Volume;CPC;Competition;Traffic (%);Number of Results\r\n';
  const row = '"seo; ""tools""\nnext";2;9007199254740993;1.25;0.5;12.3;10\r\n';
  let csv = header + row;
  options.resolveReference = async (ref) => ref === "env:SEMRUSH_V3_KEY" ? "private-v3-key" : originalResolve(ref);
  options.fetchImpl = async (address, init) => {
    if (new URL(address).pathname !== "/") return originalFetch(address, init);
    requests.push({ url: new URL(address), init });
    return new Response(csv, { headers: { "content-type": "text/csv" } });
  };
  const service = createConnectionService(options);
  await service.connectApiKey(input);
  for (const [prefix, target, value] of [["domains", "domain", "example.test"], ["urls", "url", "https://example.test/a?b=2&c=3"],
    ["subfolders", "subfolder", "example.test/blog/"]]) {
    for (const [suffix, type] of [["organicKeywords", "organic"], ["paidKeywords", "adwords"]]) {
      const call = { ...input, operation: `${prefix}.${suffix}`, input: { [target]: value, database: "us", limit: 2, offset: 50,
        display_sort: "po_asc", display_filter: "+|Ph|Co|seo", display_date: "20240115" } };
      const before = requests.length;
      const result = await service.invoke(call);
      assert.equal(requests.length, before + 1);
      assert.equal(result.rows[0][0], 'seo; "tools"\nnext');
      assert.equal(result.rows[0][2], "9007199254740993");
      const url = requests.at(-1).url;
      assert.equal(url.searchParams.get("type"), `${target}_${type}`);
      assert.equal(url.searchParams.get(target), value);
      assert.equal(url.searchParams.get("display_limit"), "52");
      assert.equal(url.searchParams.get("display_offset"), "50");
      assert.equal(url.searchParams.get("display_filter"), "+|Ph|Co|seo");
      assert.equal(url.searchParams.has("limit"), false);
      csv = header;
      assert.deepEqual((await service.invoke(call)).rows, []);
      csv = header + row.repeat(3);
      await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
      csv = header + row;
      const count = requests.length;
      for (const fields of [{ limit: 0 }, { offset: 3_999_999 }, { limit: 1001 }, { display_date: "20240199" }]) {
        await assert.rejects(service.invoke({ ...call, input: { ...call.input, ...fields } }));
      }
      assert.equal(requests.length, count);
    }
  }
});


test("Semrush tracking discovers campaigns and reads dated organic/paid position pages", async (t) => {
  const { options, requests } = await fixture(t);
  options.configuration.integrations.seo.settings = { v3ApiKeyRef: "env:SEMRUSH_V3_KEY" };
  const originalFetch = options.fetchImpl, originalResolve = options.resolveReference;
  let response = { project_id: String(project.project_id), campaigns: [{ id: "123_45", url: "example.test", device: "phone", isGathering: false }] };
  options.resolveReference = async (ref) => ref === "env:SEMRUSH_V3_KEY" ? "private-v3-key" : originalResolve(ref);
  options.fetchImpl = async (address, init) => {
    if (new URL(address).pathname.startsWith("/apis/")) return originalFetch(address, init);
    requests.push({ url: new URL(address), init });
    return Response.json(response);
  };
  const service = createConnectionService(options);
  await service.connectApiKey(input);
  const campaigns = { ...input, operation: "tracking.campaigns", input: { projectId: project.project_id } };
  assert.deepEqual(await service.invoke(campaigns), response);
  assert.equal(requests.at(-1).url.pathname, `/management/v1/projects/${project.project_id}/tracking/campaigns`);
  response = { ...response, project_id: "different" };
  await assert.rejects(service.invoke(campaigns), { code: "connector_response_invalid" });
  response = { total: "1", last_crawl: "2", data: { "0": { Dt: "20240115" } } };
  assert.deepEqual(await service.invoke({ ...input, operation: "tracking.dates", input: { campaignId: "123_45" } }), response);
  assert.equal(requests.at(-1).url.searchParams.get("type"), "tracking_campaign_dates");
  for (const [operation, type] of [["tracking.organicPositions", "tracking_position_organic"], ["tracking.paidPositions", "tracking_position_adwords"]]) {
    const entry = { Pi: "9007199254740993", Ph: "seo tools", Dt: { "20240115": { "*.example.test/*": 4 } }, Fi: { "*.example.test/*": 4 } };
    response = { total: 10, state: "0", limit: 2, offset: 3, data: { "0": entry } };
    const call = { ...input, operation, input: { campaignId: "123_45", url: "*.example.test/*", date_begin: "20240101", date_end: "20240115", display_limit: 2, display_offset: 3 } };
    const count = requests.length;
    assert.deepEqual(await service.invoke(call), response);
    assert.equal(requests.length, count + 1);
    const request = requests.at(-1);
    assert.equal(request.url.pathname, "/reports/v1/projects/123_45/tracking/");
    assert.equal(request.url.searchParams.get("type"), type);
    assert.equal(request.url.searchParams.get("display_limit"), "2");
    assert.equal(request.url.searchParams.get("key"), "private-v3-key");
    assert.equal(new Headers(request.init.headers).has("authorization"), false);
    response = { ...response, offset: 0 };
    await assert.rejects(service.invoke(call), { code: "connector_response_invalid" });
    const before = requests.length;
    for (const fields of [{ campaignId: "../../other" }, { date_begin: "20250101" }, { display_limit: 0 }]) {
      await assert.rejects(service.invoke({ ...call, input: { ...call.input, ...fields } }));
    }
    assert.equal(requests.length, before);
  }
});
