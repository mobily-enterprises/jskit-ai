import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { airtableProvider } from "../src/server/airtable.js";
import { notionProvider } from "../src/server/notion.js";
import { brevoProvider } from "../src/server/brevo.js";
import { elevenlabsProvider } from "../src/server/elevenlabs.js";
import { githubApiProvider } from "../src/server/github-api.js";
import { apifyProvider } from "../src/server/apify.js";
import { calendlyProvider } from "../src/server/calendly.js";
import { hubspotProvider } from "../src/server/hubspot.js";
import { linearProvider } from "../src/server/linear.js";
import { pipedriveProvider } from "../src/server/pipedrive.js";
import { gitlabApiProvider } from "../src/server/gitlab-api.js";
import { tallyProvider } from "../src/server/tally.js";
import { contentfulProvider } from "../src/server/contentful.js";
import { asanaProvider } from "../src/server/asana.js";
import { ashbyProvider } from "../src/server/ashby.js";
import { lexwareProvider } from "../src/server/lexware.js";
import { sevdeskProvider } from "../src/server/sevdesk.js";
import { apolloIoProvider } from "../src/server/apollo-io.js";
import { attentionProvider } from "../src/server/attention.js";
import { telegramProvider } from "../src/server/telegram.js";
import { klipyProvider } from "../src/server/klipy.js";
import { clayProvider } from "../src/server/clay.js";

import { stripeProvider } from "../src/server/stripe.js";
import { replicateProvider } from "../src/server/replicate.js";
import { incidentIoProvider } from "../src/server/incident-io.js";
import { firefliesProvider } from "../src/server/fireflies.js";

import { heygenProvider } from "../src/server/heygen.js";
import { perplexityProvider } from "../src/server/perplexity.js";
import { supabaseProvider } from "../src/server/supabase.js";
import { paddleProvider } from "../src/server/paddle.js";
import { mailgunProvider } from "../src/server/mailgun.js";
import { fireworksAiProvider } from "../src/server/fireworks-ai.js";
import { gatewayApiProvider, verifyGatewayApiEvent } from "../src/server/gatewayapi.js";
import { polarProvider } from "../src/server/polar.js";
import { storyblokProvider } from "../src/server/storyblok.js";

const cases = [
  { provider: clayProvider, check: "/public/v0/me", header: "clay-api-key", prefix: "",
    response: { user: { id: "user-1", name: null }, workspace: { id: "workspace-1", name: "Fixture" } },
    operation: "searches.create", operationPath: "/public/v0/search/query-mode",
    input: { query: 'select from companies where people.exists(is_current = true and job_title is_similar_to ("VP Sales"))' }, body: { query: 'select from companies where people.exists(is_current = true and job_title is_similar_to ("VP Sales"))' },
    operationResponse: { search_id: "search-1", source_type: "companies" } },
  { provider: telegramProvider, check: "/getMe", key: "123456:fixture_token", rotatedKey: "123456:rotated_token",
    pathPrefix: "/bot123456:fixture_token", rotatedPathPrefix: "/bot123456:rotated_token",
    response: { ok: true, result: { id: 123456, is_bot: true, first_name: "Fixture bot", username: "fixture_bot" } },
    operation: "webhook.read", operationPath: "/getWebhookInfo",
    operationResponse: { ok: true, result: { url: "https://example.test/bot", has_custom_certificate: false, pending_update_count: 12 } } },
  { provider: klipyProvider, check: "/clips/trending", pathPrefix: "/api/v1/private-fixture-key", rotatedPathPrefix: "/api/v1/rotated-fixture-key",
    response: { result: true, data: { data: [{ slug: "fixture-clip", title: "Fixture", file: {} }], next: true } },
    operation: "clips.search", operationPath: "/clips/search",
    input: { q: "Cats & dogs", page: 2, per_page: 8, locale: "us", customer_id: "subject & 2", content_filter: "medium" },
    query: { q: "Cats & dogs", page: "2", per_page: "8", locale: "us", customer_id: "subject & 2", content_filter: "medium" } },
  { provider: apolloIoProvider, check: "/api/v1/accounts/search", header: "x-api-key", prefix: "", method: "POST",
    response: { accounts: [{ id: "account-1", name: "Saved company" }] },
    input: { page: 2, per_page: 10, q_organization_name: "Design & partners" }, body: { page: 2, per_page: 10, q_organization_name: "Design & partners" } },
  { provider: attentionProvider, check: "/v2/conversations/list", header: "authorization", prefix: "Bearer ",
    response: { data: [{ id: "conversation-1", type: "conversations", attributes: { title: "Review" } }], meta: { totalRecords: 150 }, links: { related: "/v2/conversations?page=2" } },
    input: { page: 2, size: 10, "filter[title]": "Design & review", "filter[hide_internal]": false, detailedTranscript: true },
    query: { page: "2", size: "10", "filter[title]": "Design & review", "filter[hide_internal]": "false", detailedTranscript: "true" } },
  { provider: ashbyProvider, check: "/job.list", header: "authorization", method: "POST",
    initialHeader: `Basic ${Buffer.from("private-fixture-key:").toString("base64")}`, rotatedHeader: `Basic ${Buffer.from("rotated-fixture-key:").toString("base64")}`,
    response: { success: true, results: [{ id: "job-1", title: "Developer" }], moreDataAvailable: true, nextCursor: "next-cursor", syncToken: "current-sync" },
    input: { limit: 2, cursor: "cursor & 2", syncToken: "sync & 1" }, body: { limit: 2, cursor: "cursor & 2", syncToken: "sync & 1" }, extraHeaders: { Accept: "application/json; version=1" } },
  { provider: lexwareProvider, check: "/v1/contacts", header: "authorization", prefix: "Bearer ",
    response: { content: [{ id: "contact-1", roles: { customer: { number: 1 } } }], first: true, last: false, totalPages: 2, totalElements: 26, numberOfElements: 1, size: 25, number: 0 },
    input: { size: 2, page: 1, customer: false, vendor: true }, query: { size: "2", page: "1", customer: "false", vendor: "true" } },
  { provider: sevdeskProvider, check: "/api/v1/Contact", header: "authorization", prefix: "",
    response: { objects: [{ id: "1", objectName: "Contact", name: "Fixture" }], total: "101" },
    input: { limit: 2, offset: 4, countAll: true, depth: 0 }, query: { limit: "2", offset: "4", countAll: "true", depth: "0" } },
  { provider: storyblokProvider, check: "/v2/cdn/spaces/me", queryCredential: "token", response: { space: { id: 123, name: "Fixture", language_codes: ["de"], version: 1544117388 } }, operation: "stories.list", operationPath: "/v2/cdn/stories", operationResponse: { stories: [{ id: 456, content: { title: "Fixture" } }], cv: 1544117388, rels: [], links: [] }, input: { page: 2, per_page: 10, starts_with: "blog/", search_term: "Notes & plans", language: "de", cv: 1544117388 }, query: { version: "published", page: "2", per_page: "10", starts_with: "blog/", search_term: "Notes & plans", language: "de", cv: "1544117388" } },
  { provider: fireworksAiProvider, check: "/v1/accounts", header: "authorization", prefix: "Bearer ", extraHeaders: { "content-type": "application/json" }, response: { accounts: [{ name: "accounts/fixture", displayName: "Fixture" }], nextPageToken: "next & 2", totalSize: 3 }, input: { pageSize: 2, pageToken: "next & 2", filter: "displayName=Fixture" }, query: { pageSize: "2", pageToken: "next & 2", filter: "displayName=Fixture" } },
  { provider: gatewayApiProvider, check: "/rest/me", header: "authorization", prefix: "Token ", response: { id: 123, credit: "1234.56", currency: "DKK" } },
  { provider: polarProvider, check: "/v1/products/", header: "authorization", prefix: "Bearer ", response: { items: [{ id: "product-1", name: "Fixture" }], pagination: { total_count: 21, max_page: 3 } }, input: { page: 2, limit: 10, query: "Fixture & plans", is_archived: false, is_recurring: true }, query: { page: "2", limit: "10", query: "Fixture & plans", is_archived: "false", is_recurring: "true" } },
  { provider: paddleProvider, check: "/products", header: "authorization", prefix: "Bearer ", extraHeaders: { "paddle-version": "1" }, response: { data: [{ id: "pro_fixture", name: "Fixture" }], meta: { request_id: "request-1", pagination: { per_page: 50, has_more: true, next: "https://sandbox-api.paddle.com/products?after=pro_fixture" } } }, input: { per_page: 2, after: "pro_fixture", status: "archived" }, query: { per_page: "2", after: "pro_fixture", status: "archived" } },
  { provider: mailgunProvider, check: "/v4/domains", header: "authorization", prefix: "Basic ", initialHeader: "Basic YXBpOnByaXZhdGUtZml4dHVyZS1rZXk=", rotatedHeader: "Basic YXBpOnJvdGF0ZWQtZml4dHVyZS1rZXk=", response: { total_count: 1, items: [{ name: "example.com", state: "active" }] }, input: { limit: 2, skip: 4, state: "active", sort: "name:asc", search: "example.com", include_subaccounts: true }, query: { limit: "2", skip: "4", state: "active", sort: "name:asc", search: "example.com", include_subaccounts: "true" } },
  { provider: heygenProvider, check: "/v3/users/me", header: "x-api-key", prefix: "", response: { data: { username: "fixture", email: "fixture@example.com", billing_type: "wallet" } }, operation: "voices.list", operationPath: "/v3/voices", operationResponse: { data: [{ voice_id: "voice-1", name: "Fixture" }], has_more: true, next_token: "page & 2" }, input: { limit: 2, token: "page & 2", type: "private", engine: "starfish", language: "English", gender: "female" }, query: { limit: "2", token: "page & 2", type: "private", engine: "starfish", language: "English", gender: "female" } },
  { provider: perplexityProvider, check: "/v1/async/sonar", header: "authorization", prefix: "Bearer ", response: { requests: [{ id: "request-1", created_at: 123, model: "sonar", status: "COMPLETED" }], next_token: null }, operation: "models.list", operationPath: "/v1/models", operationResponse: { object: "list", data: [{ id: "example/model", object: "model", created: 0, owned_by: "example" }] } },
  { provider: supabaseProvider, check: "/v1/projects", header: "authorization", prefix: "Bearer ", response: [{ id: "project-1", ref: "project-reference", name: "Fixture", organization_id: "organization-1", region: "ap-southeast-2", status: "ACTIVE_HEALTHY" }] },
  { provider: stripeProvider, check: "/v1/balance", header: "authorization", prefix: "Bearer ", response: { object: "balance", available: [{ amount: 1500, currency: "aud", source_types: { card: 1500 } }], pending: [], livemode: false } },
  { provider: replicateProvider, check: "/v1/account", header: "authorization", prefix: "Bearer ", response: { type: "organization", username: "fixture", name: "Fixture" }, operation: "hardware.list", operationPath: "/v1/hardware", operationResponse: [{ name: "CPU", sku: "cpu" }] },
  { provider: incidentIoProvider, check: "/v2/incidents", header: "authorization", prefix: "Bearer ", response: { incidents: [{ id: "incident-1", name: "Fixture" }], pagination_meta: { page_size: 25, after: "next", total_record_count: 42 } }, input: { page_size: 2, after: "next & 2", sort_by: "created_at_oldest_first" }, query: { page_size: "2", after: "next & 2", sort_by: "created_at_oldest_first" } },
  { provider: firefliesProvider, check: "/graphql", header: "authorization", prefix: "Bearer ", method: "POST", response: { data: { user: { user_id: "user-1", name: "Fixture", email: "test@example.com" } } }, operation: "transcripts.list", operationResponse: { data: { transcripts: [{ id: "meeting-1", title: "Fixture" }] } }, input: { limit: 2, skip: 4, mine: false }, body: { query: "query ConnectorTranscripts($limit: Int!, $skip: Int!, $mine: Boolean!) { transcripts(limit: $limit, skip: $skip, mine: $mine) { id title } }", variables: { limit: 2, skip: 4, mine: false } } },
  { provider: airtableProvider, check: "/v0/meta/bases", header: "authorization", prefix: "Bearer ", response: { bases: [{ id: "app1", name: "Example" }], offset: "next/page" }, input: { offset: "next/page & 2" }, query: { offset: "next/page & 2" } },
  { provider: notionProvider, check: "/v1/search", header: "authorization", prefix: "Bearer ", response: { object: "list", results: [], next_cursor: "next", has_more: true }, method: "POST", input: { query: "Notes & plans", start_cursor: "cursor", page_size: 2 }, body: { query: "Notes & plans", start_cursor: "cursor", page_size: 2 }, extraHeaders: { "Notion-Version": "2026-03-11" } },
  { provider: brevoProvider, check: "/v3/contacts", header: "api-key", prefix: "", response: { contacts: [], count: 12 }, input: { limit: 2, offset: 4, sort: "asc" }, query: { limit: "2", offset: "4", sort: "asc" } },
  { provider: elevenlabsProvider, check: "/v1/user", header: "xi-api-key", prefix: "", response: { user_id: "user-1" }, operation: "voices.list", operationPath: "/v2/voices", operationResponse: { voices: [], next_page_token: "page", has_more: true }, input: { page_size: 2, next_page_token: "page & 2", search: "Voice" }, query: { page_size: "2", next_page_token: "page & 2", search: "Voice" } },
  { provider: githubApiProvider, check: "/user", header: "authorization", prefix: "Bearer ", response: { id: 42, login: "example" }, operation: "repositories.list", operationPath: "/user/repos", operationResponse: [{ id: 10, full_name: "example/repository" }], input: { per_page: 2, page: 3 }, query: { per_page: "2", page: "3" }, extraHeaders: { "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "jskit-connectors", Accept: "application/vnd.github+json" } },
  { provider: apifyProvider, check: "/v2/actors", header: "authorization", prefix: "Bearer ", response: { data: { items: [], total: 12, offset: 0, count: 0, limit: 100 } }, input: { limit: 2, offset: 4, desc: true }, query: { limit: "2", offset: "4", desc: "true" } },
  { provider: calendlyProvider, check: "/users/me", header: "authorization", prefix: "Bearer ", response: { resource: { uri: "https://api.calendly.com/users/fixture", name: "Fixture" } }, operation: "eventTypes.list", operationPath: "/event_types", operationResponse: { collection: [], pagination: { count: 0, next_page_token: "page & 2" } }, input: { user: "https://api.calendly.com/users/fixture", count: 2, page_token: "page & 2", active: false }, query: { user: "https://api.calendly.com/users/fixture", count: "2", page_token: "page & 2", active: "false" } },
  { provider: hubspotProvider, scopes: ["crm.objects.contacts.read"], check: "/crm/objects/2026-09/contacts", header: "authorization", prefix: "Bearer ", response: { results: [], paging: { next: { after: "42" } } }, input: { limit: 2, after: "42", archived: true }, query: { limit: "2", after: "42", archived: "true" } },
  { provider: linearProvider, scopes: ["read"], check: "/graphql", header: "authorization", prefix: "", response: { data: { viewer: { id: "user-1", name: "Fixture" } } }, method: "POST", operation: "issues.list", operationResponse: { data: { issues: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "next" } } } }, input: { first: 2, after: "cursor & 2" }, body: { query: "query ConnectorIssues($first: Int!, $after: String) { issues(first: $first, after: $after) { nodes { id identifier title } pageInfo { hasNextPage endCursor } } }", variables: { first: 2, after: "cursor & 2" } } },
  { provider: pipedriveProvider, check: "/v1/users/me", header: "x-api-token", prefix: "", response: { success: true, data: { id: 42, name: "Fixture", company_domain: "fixture" } } },
  { provider: gitlabApiProvider, check: "/api/v4/user", header: "PRIVATE-TOKEN", prefix: "", response: { id: 42, username: "fixture" }, operation: "projects.list", operationPath: "/api/v4/projects", operationResponse: [{ id: 1, path_with_namespace: "fixture/project" }], input: { per_page: 2, page: 3 }, query: { per_page: "2", page: "3", membership: "true", simple: "true" } },
  { provider: tallyProvider, check: "/forms", header: "authorization", prefix: "Bearer ", response: { items: [], page: 1, limit: 50, total: 0, hasMore: false }, input: { limit: 2, page: 3 }, query: { limit: "2", page: "3" }, extraHeaders: { "tally-version": "2025-02-01" } },
  { provider: contentfulProvider, settings: { spaceId: "space-one" }, check: "/spaces/space-one/environments/master/entries", header: "authorization", prefix: "Bearer ", response: { sys: { type: "Array" }, items: [], skip: 0, limit: 1, total: 0 }, input: { limit: 2, skip: 4, content_type: "article" }, query: { limit: "2", skip: "4", content_type: "article" } },
  { provider: asanaProvider, check: "/api/1.0/workspaces", header: "authorization", prefix: "Bearer ", response: { data: [{ gid: "123", name: "Fixture" }], next_page: { offset: "next & 2" } }, input: { limit: 2, offset: "next & 2" }, query: { limit: "2", offset: "next & 2" } }
];

async function fixture(t, entry) {
  const directory = await mkdtemp(path.join(tmpdir(), "connector-token-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = { key: entry.key || "private-fixture-key", status: 200, response: entry.response };
  const requests = [];
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(5) }, activeKeyId: "current" });
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: {
      source: { provider: entry.provider.id, ...(entry.settings ? { settings: entry.settings } : {}), accountMode: "shared", scopes: entry.scopes || (entry.provider.id === "calendly" ? ["users:read", "event_types:read"] : []), authentication: { method: "api-key", secretRef: "env:SERVICE_TOKEN" } }
    } },
    providers: [entry.provider], authorize: async (context) => context,
    resolveReference: async () => state.key,
    store: createFileConnectionStore({ directory, protection }),
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(String(url)), init, headers: new Headers(init.headers) });
      return Response.json(state.response, { status: state.status });
    }
  };
  const input = { context: { applicationId: "app-one", subjectId: "account-one" }, integrationId: "source" };
  return { service: createConnectionService(options), options, directory, protection, input, state, requests };
}

for (const entry of cases) {
  test(`${entry.provider.id}: verifies its credential and performs the documented operation after a file-store restart`, async (t) => {
    const { service, options, directory, protection, input, state, requests } = await fixture(t, entry);
    assert.equal((await service.connectApiKey(input)).status, "connected");
    const first = requests[0];
    assert.equal(first.url.origin, (typeof entry.provider.apiOrigins === "function" ? entry.provider.apiOrigins(entry.settings || {}) : entry.provider.apiOrigins)[0]);
    assert.equal(first.url.pathname, (entry.pathPrefix || "") + entry.check);
    assert.equal(first.init.method, entry.method || "GET");
    if (entry.pathPrefix) {
      assert.equal(first.headers.has("authorization"), false);
    } else if (entry.queryCredential) {
      assert.deepEqual(first.url.searchParams.getAll(entry.queryCredential), [state.key]);
      assert.equal(first.headers.has("authorization"), false);
    } else assert.equal(first.headers.get(entry.header), entry.initialHeader || entry.prefix + state.key);
    assert.equal(first.init.redirect, "error");
    for (const [header, value] of Object.entries(entry.extraHeaders || {})) assert.equal(first.headers.get(header), value);
    for (const name of await readdir(directory)) assert.equal((await readFile(path.join(directory, name), "utf8")).includes(state.key), false);
    const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
    assert.equal((await restarted.status(input)).status, "connected");
    state.response = entry.operationResponse || entry.response;
    state.key = entry.rotatedKey || "rotated-fixture-key";
    const result = await restarted.invoke({ ...input, operation: entry.operation || entry.provider.checkOperation, input: entry.input });
    assert.deepEqual(result, state.response);
    const request = requests.at(-1);
    assert.equal(request.url.pathname, (entry.rotatedPathPrefix || "") + (entry.operationPath || entry.check));
    if (entry.pathPrefix) assert.equal(request.headers.has("authorization"), false);
    else if (entry.queryCredential) assert.equal(request.url.searchParams.get(entry.queryCredential), state.key);
    else assert.equal(request.headers.get(entry.header), entry.rotatedHeader || entry.prefix + state.key);
    for (const [key, value] of Object.entries(entry.query || {})) assert.equal(request.url.searchParams.get(key), value);
    if (entry.body) assert.deepEqual(JSON.parse(request.init.body), entry.body);
    await assert.rejects(restarted.invoke({ ...input, context: { ...input.context, applicationId: "app-two" }, operation: typeof entry.provider.checkOperation === "function" ? entry.provider.checkOperation("api-key") : entry.provider.checkOperation }), { code: "connector_reconnect_required" });
    await restarted.disconnect(input);
    assert.equal((await service.status(input)).status, "disconnected");
  });

  test(`${entry.provider.id}: rejects invalid inputs, malformed successes, invalid keys and rate limits without leaking credentials`, async (t) => {
    const { service, input, state, requests } = await fixture(t, entry);
    for (const [status, code] of [[200, "connector_response_invalid"], [401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"]]) {
      state.status = status;
      state.response = { error: { message: state.key } };
      await assert.rejects(service.connectApiKey(input), (error) => {
        assert.equal(error.code, code);
        assert.equal(JSON.stringify(error).includes(state.key), false);
        return true;
      });
      assert.equal((await service.status(input)).status, "disconnected");
    }
    state.status = 200;
    state.response = entry.response;
    await service.connectApiKey(input);
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: entry.operation || entry.provider.checkOperation, input: { ...entry.input, unknown: "reject" } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, count);
    state.status = 401;
    await assert.rejects(service.invoke({ ...input, operation: typeof entry.provider.checkOperation === "function" ? entry.provider.checkOperation("api-key") : entry.provider.checkOperation }), { code: "connector_reconnect_required" });
    assert.equal((await service.status(input)).status, "reconnect-required");
  });
}

test("Clay advances only explicitly requested query pages and validates each result envelope", async (t) => {
  const { service, input, state, requests } = await fixture(t, cases.find(({ provider }) => provider === clayProvider));
  await service.connectApiKey(input);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, "/public/v0/me");
  state.response = { data: [{ clay_company_id: 123, name: "Fixture" }], has_more: true, source_type: "companies",
    period_quota: { limit: 1000, used: 20, remaining: 980, resets_at: "2026-10-01T00:00:00Z" } };
  assert.deepEqual(await service.invoke({ ...input, operation: "searches.next", input: { searchId: "search-1" } }), state.response);
  assert.equal(requests.length, 2);
  assert.equal(requests.at(-1).url.href, "https://api.clay.com/public/v0/search/query-mode/search-1/run");
  assert.equal(requests.at(-1).init.method, "POST");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { limit: 20 });
  state.response = { data: [], has_more: false, source_type: "people", exhaustion_reason: "no_more_results" };
  assert.deepEqual(await service.invoke({ ...input, operation: "searches.next", input: { searchId: "search_2", limit: 500 } }), state.response);
  assert.equal(requests.length, 3);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { limit: 500 });
  const count = requests.length;
  for (const invalid of [{}, { query: "" }, { query: "  " }, { query: "x".repeat(16001) }, { query: "x", apiKey: "caller-key" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "searches.create", input: invalid }), { code: "connector_input_invalid" });
  }
  for (const invalid of [{}, { searchId: ".." }, { searchId: "a/b" }, { searchId: "https://other.invalid" },
    { searchId: "search-1", limit: 0 }, { searchId: "search-1", limit: 501 }, { searchId: "search-1", limit: 1.5 }, { searchId: "search-1", page: 2 }]) {
    await assert.rejects(service.invoke({ ...input, operation: "searches.next", input: invalid }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  for (const malformed of [{ data: [], source_type: "people" }, { data: {}, has_more: false, source_type: "companies" },
    { data: [], has_more: false, source_type: "jobs" }]) {
    state.response = malformed;
    await assert.rejects(service.invoke({ ...input, operation: "searches.next", input: { searchId: "search-1" } }), { code: "connector_response_invalid" });
  }
  assert.equal(clayProvider.operations["identity.read"].validateResult({ user: { id: "user-1" }, workspace: {} }), false);
  assert.equal(clayProvider.operations["searches.create"].validateResult({ search_id: "search-1", source_type: "jobs" }), false);
});

test("Clay search policy, billing failure and interrupted iterators never replay a request", async (t) => {
  const { service, options, input, state, requests } = await fixture(t, cases.find(({ provider }) => provider === clayProvider));
  await service.connectApiKey(input);
  const restricted = createConnectionService({ ...options, authorize: async (owner, request) =>
    request.operation === "searches.create" || request.operation === "searches.next" && request.input.searchId !== "search-1" ? null : owner });
  await assert.rejects(restricted.invoke({ ...input, operation: "searches.create", input: { query: "anything" } }), { code: "connector_access_denied" });
  await assert.rejects(restricted.invoke({ ...input, operation: "searches.next", input: { searchId: "another-search" } }), { code: "connector_access_denied" });
  assert.equal(requests.length, 1);
  state.status = 402;
  state.response = { message: `Credit limit: ${state.key}` };
  await assert.rejects(service.invoke({ ...input, operation: "searches.next", input: { searchId: "search-1" } }), (error) => {
    assert.equal(error.code, "connector_provider_failed");
    assert(!JSON.stringify(error).includes(state.key));
    return true;
  });
  assert.equal(requests.length, 2);
  let started;
  const pendingRequest = new Promise((resolve) => { started = resolve; });
  let attempts = 0;
  const interrupted = createConnectionService({ ...options, fetchImpl: async (_url, init) => {
    attempts += 1;
    init.signal.throwIfAborted();
    started();
    return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  } });
  const controller = new AbortController();
  const pending = assert.rejects(interrupted.invoke({ ...input, operation: "searches.next", input: { searchId: "search-1" }, signal: controller.signal }), { code: "connector_cancelled" });
  await pendingRequest;
  controller.abort();
  await pending;
  assert.equal(attempts, 1);
});

test("Clay runs approved routines and queries Enterprise tables without replay or hidden paging", async t => {
  const { service, options, input, state, requests } = await fixture(t, cases.find(({ provider }) => provider === clayProvider));
  await service.connectApiKey(input);
  const invoke = (operation, values = {}) => service.invoke({ ...input, operation, input: values });
  state.response = { reference: "Provider-owned query grammar" };
  assert.deepEqual(await invoke("searches.reference"), state.response);
  assert.equal(requests.at(-1).url.pathname, "/public/v0/search/query-mode/reference");
  state.response = { balance: 10, action_execution_balance: 20 };
  assert.deepEqual(await invoke("credits.balance"), state.response);
  const items = [{ id: "row-1", inputs: { domain: "example.test" } }];
  state.response = { routine_run_id: "run-1", status: "in_progress" }; state.status = 202;
  assert.deepEqual(await invoke("routines.run", { routineId: "function:t_example", items }), state.response);
  assert.equal(requests.at(-1).url.pathname, "/public/v0/routines/function%3At_example/run");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { items });
  state.response = { routine_run_id: "run-1", total: 1, finished: 0, status: "in_progress" };
  assert.deepEqual(await invoke("routines.results", { routineId: "run-1" }), state.response);
  state.status = 200; state.response = { routine_run_id: "run-1", total: 1, finished: 1, status: "complete", data: [{ id: "row-1", error: "enrichment unavailable" }], cursor: "next+opaque" };
  assert.deepEqual(await invoke("routines.results", { routineId: "run-1", cursor: "prior+&cursor", limit: 100 }), state.response);
  assert.equal(requests.at(-1).url.searchParams.get("cursor"), "prior+&cursor");
  const query = { tables: [{ id: "t_example" }], select: [{ field: "Domain", as: "domain" }], filter: { field: "Domain", op: "is_not_empty" }, field_mode: "names" };
  state.response = { data: [{ domain: { value: "example.test" } }], fields: { domain: { name: "Domain" } }, truncated: true };
  assert.deepEqual(await invoke("tables.query", { query, limit: 100 }), state.response);
  assert.equal(requests.at(-1).url.pathname, "/public/v0/tables/query");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { query, limit: 100 });
  const count = requests.length;
  for (const [operation, values] of [["routines.run", { routineId: "../other", items }], ["routines.run", { routineId: "function:t_x", items: [] }],
    ["routines.run", { routineId: "x", items: [{ id: "x" }] }], ["tables.query", { query: { tables: [] } }],
    ["tables.query", { query, limit: 101 }], ["tables.query", { query: { ...query, url: "https://other.test" } }]])
    await assert.rejects(invoke(operation, values), { code: "connector_input_invalid" });
  const restricted = createConnectionService({ ...options, authorize: async (owner, request) => request.operation === "routines.run" ? null : owner });
  await assert.rejects(restricted.invoke({ ...input, operation: "routines.run", input: { routineId: "x", items } }), { code: "connector_access_denied" });
  assert.equal(requests.length, count);
  state.response = { status: "complete" };
  await assert.rejects(invoke("routines.results", { routineId: "run-1" }), { code: "connector_response_invalid" });
  for (const status of [402, 403, 422, 429, 500]) { state.status = status; const before = requests.length; await assert.rejects(invoke("routines.run", { routineId: "function:t_x", items })); assert.equal(requests.length, before + 1); }
});

test("regional connections require re-verification before changing their provider destination", async (t) => {
  for (const [provider, setting, alternative] of [
    [paddleProvider, "environment", "live"], [mailgunProvider, "region", "eu"],
    [gatewayApiProvider, "region", "eu"], [polarProvider, "environment", "production"],
    [storyblokProvider, "region", "us"]
  ]) {
    const entry = cases.find((item) => item.provider === provider);
    const { service, options, input, requests } = await fixture(t, entry);
    await service.connectApiKey(input);
    const config = structuredClone(options.configuration);
    config.integrations.source.settings = { [setting]: alternative };
    const changed = createConnectionService({ ...options, configuration: config });
    assert.equal((await changed.status(input)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...input, operation: provider.checkOperation }), { code: "connector_reconnect_required" });
    assert.equal(requests.length, 1);
    await changed.connectApiKey(input);
    assert.equal(requests.at(-1).url.origin, provider.apiOrigins[1]);
    await changed.invoke({ ...input, operation: provider.checkOperation });
    assert.equal(requests.at(-1).url.origin, provider.apiOrigins[1]);
    assert.equal((await service.status(input)).status, "reconnect-required");
    config.integrations.source.settings[setting] = "https://attacker.invalid";
    const count = requests.length;
    assert.throws(() => createConnectionService({ ...options, configuration: config }), { code: "integration_configuration_invalid" });
    assert.equal(requests.length, count);
  }
});

test("Storyblok supports all space regions and requires explicit draft reads without accepting caller credentials", async (t) => {
  const entry = cases.find(({ provider }) => provider === storyblokProvider);
  const { service, options, input, state, requests } = await fixture(t, entry);
  for (const [region, host] of [
    ["eu", "api.storyblok.com"], ["us", "api-us.storyblok.com"], ["ca", "api-ca.storyblok.com"],
    ["ap", "api-ap.storyblok.com"], ["cn", "app.storyblokchina.cn"]
  ]) {
    const config = structuredClone(options.configuration);
    config.integrations.source.settings = { region };
    const regional = createConnectionService({ ...options, configuration: config });
    state.response = entry.response;
    await regional.connectApiKey(input);
    assert.equal(requests.at(-1).url.host, host);
    state.response = { stories: [] };
    assert.deepEqual(await regional.invoke({ ...input, operation: "stories.list" }), state.response);
    assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), {
      version: "published", page: "1", per_page: "25", token: state.key
    });
    await regional.invoke({ ...input, operation: "stories.list", input: { version: "draft", per_page: 100 } });
    assert.equal(requests.at(-1).url.searchParams.get("version"), "draft");
    assert.equal(requests.at(-1).url.searchParams.get("per_page"), "100");
    const count = requests.length;
    for (const invalid of [{ token: "caller-key" }, { version: "all" }, { per_page: 0 }, { per_page: 101 }, { page: 0 }, { cv: -1 }]) {
      await assert.rejects(regional.invoke({ ...input, operation: "stories.list", input: invalid }), { code: "connector_input_invalid" });
    }
    assert.equal(requests.length, count);
  }
  state.response = entry.response;
  await service.connectApiKey(input);
  state.status = 403;
  state.response = { error: "Preview access required" };
  await assert.rejects(service.invoke({ ...input, operation: "stories.list", input: { version: "draft" } }), { code: "connector_permission_denied" });
  assert.equal(requests.at(-1).url.searchParams.get("version"), "draft");
  assert.equal(storyblokProvider.operations["space.read"].validateResult({ space: { name: "incomplete" } }), false);
});

test("Storyblok delivers one page with resolved content and keeps private previews behind application policy", async (t) => {
  const entry = cases.find(({ provider }) => provider === storyblokProvider);
  const f = await fixture(t, entry);
  await f.service.connectApiKey(f.input);
  const content = { id: 123, full_slug: "bookings/groom & wash", content: { component: "page", title: "Grooming" } };
  f.state.response = { story: content, rels: [{ id: 456, content: { component: "author", name: "Pat" } }],
    assets: [{ id: 789, filename: "https://a.storyblok.com/f/123/photo.jpg", alt: "A groomed dog" }], links: [], cv: 42 };
  assert.deepEqual(await f.service.invoke({ ...f.input, operation: "stories.get", input: {
    id: content.full_slug, resolve_relations: "page.author", resolve_links: "url", resolve_assets: 1, cv: 42
  } }), f.state.response);
  const request = f.requests.at(-1);
  assert.equal(request.init.method, "GET");
  assert.equal(request.url.pathname, "/v2/cdn/stories/bookings/groom%20%26%20wash");
  assert.deepEqual(Object.fromEntries(request.url.searchParams), { version: "published", cv: "42",
    resolve_relations: "page.author", resolve_links: "url", resolve_assets: "1", token: f.state.key });
  const restricted = createConnectionService({ ...f.options, authorize: async (owner, request) => request.input?.version === "draft" ? null : owner });
  const before = f.requests.length;
  await assert.rejects(restricted.invoke({ ...f.input, operation: "stories.get", input: { id: "home", version: "draft" } }), { code: "connector_access_denied" });
  for (const id of ["../private", "a/../private", "a//b", "/home"]) {
    await assert.rejects(f.service.invoke({ ...f.input, operation: "stories.get", input: { id } }), { code: "connector_input_invalid" });
  }
  assert.equal(f.requests.length, before);
  f.state.response = { story: { id: 123, content: null } };
  await assert.rejects(f.service.invoke({ ...f.input, operation: "stories.get", input: { id: "home" } }), { code: "connector_response_invalid" });
  f.state.status = 404; f.state.response = { message: "Not found" };
  await assert.rejects(f.service.invoke({ ...f.input, operation: "stories.get", input: { id: "unpublished" } }));
  assert.equal(f.requests.at(-1).url.searchParams.get("version"), "published");
});

test("regional and account readers retain pagination defaults and reject oversized pages", () => {
  for (const [provider, settings, size, maximum, defaults] of [
    [paddleProvider, { environment: "sandbox" }, "per_page", 200, { per_page: "50", status: "active" }],
    [mailgunProvider, { region: "us" }, "limit", 1000, { limit: "100", skip: "0", include_subaccounts: "false" }],
    [fireworksAiProvider, {}, "pageSize", 200, { pageSize: "50" }],
    [polarProvider, { environment: "sandbox" }, "limit", 100, { page: "1", limit: "10" }]
  ]) {
    const operation = provider.operations[provider.checkOperation];
    const url = new URL(operation.request({}, settings).url);
    assert.deepEqual(Object.fromEntries(url.searchParams), defaults);
    for (const value of [0, maximum + 1]) assert.throws(() => operation.request({ [size]: value }, settings));
  }
});

test("provider page sizes reject zero and values above the provider limit", () => {
  for (const [provider, operation, field, maximum] of [
    [notionProvider, "content.search", "page_size", 100], [brevoProvider, "contacts.list", "limit", 1000],
    [elevenlabsProvider, "voices.list", "page_size", 100], [githubApiProvider, "repositories.list", "per_page", 100],
    [apifyProvider, "actors.list", "limit", 1000], [hubspotProvider, "contacts.list", "limit", 100],
    [linearProvider, "issues.list", "first", 100], [gitlabApiProvider, "projects.list", "per_page", 100],
    [tallyProvider, "forms.list", "limit", 500], [contentfulProvider, "entries.list", "limit", 1000],
    [asanaProvider, "workspaces.list", "limit", 100],
    [incidentIoProvider, "incidents.list", "page_size", 500],
    [firefliesProvider, "transcripts.list", "limit", 50], [heygenProvider, "voices.list", "limit", 100]
  ]) {
    for (const value of [0, maximum + 1]) assert.throws(() => provider.operations[operation].request({ [field]: value }), (error) => Boolean(error.fieldErrors[field]));
  }
});

test("Linear rejects GraphQL errors even when the HTTP request and some data succeed", async (t) => {
  const entry = cases.find(({ provider }) => provider === linearProvider);
  const { service, input, state, requests } = await fixture(t, entry);
  state.response = { ...entry.response, errors: [{ message: state.key, extensions: { code: "FORBIDDEN" } }] };
  await assert.rejects(service.connectApiKey(input), { code: "connector_response_invalid" });
  assert.equal((await service.status(input)).status, "disconnected");
  assert.deepEqual(JSON.parse(requests[0].init.body), { query: "query ConnectorViewer { viewer { id name email } }", variables: {} });
  state.response = entry.response;
  await service.connectApiKey(input);
  state.response = { ...entry.operationResponse, errors: [{ message: state.key }] };
  await assert.rejects(service.invoke({ ...input, operation: "issues.list" }), { code: "connector_response_invalid" });
});

test("Calendly requires a user URI and GitLab keeps project lists within membership", () => {
  assert.throws(() => calendlyProvider.operations["eventTypes.list"].request({}), (error) => Boolean(error.fieldErrors.user));
  for (const count of [0, 101]) {
    assert.throws(() => calendlyProvider.operations["eventTypes.list"].request({ user: "https://api.calendly.com/users/fixture", count }), (error) => Boolean(error.fieldErrors.count));
  }
  for (const field of ["membership", "simple"]) {
    assert.throws(() => gitlabApiProvider.operations["projects.list"].request({ [field]: false }), (error) => Boolean(error.fieldErrors[field]));
  }
});


test("Fireflies rejects partial GraphQL errors and uses the authenticated user's profile", async (t) => {
  const entry = cases.find(({ provider }) => provider === firefliesProvider);
  const { service, input, state, requests } = await fixture(t, entry);
  state.response = { ...entry.response, errors: [{ message: state.key }] };
  await assert.rejects(service.connectApiKey(input), { code: "connector_response_invalid" });
  assert.equal((await service.status(input)).status, "disconnected");
  assert.deepEqual(JSON.parse(requests[0].init.body), { query: "query ConnectorUser { user { user_id name email } }", variables: {} });
  state.response = entry.response;
  await service.connectApiKey(input);
  state.response = { data: { transcript: { id: "meeting-1", title: "Planning", sentences: [{ speaker_name: "Ana", text: "Book the appointment", start_time: 1, end_time: 3 }], summary: { action_items: "Book appointment" } } } };
  const detail = await service.invoke({ ...input, operation: "transcripts.get", input: { id: "meeting-1" } });
  assert.equal(detail.data.transcript.sentences[0].text, "Book the appointment");
  assert.equal(detail.data.transcript.summary.action_items, "Book appointment");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { id: "meeting-1" });
  state.response = { data: { transcript: null } };
  await assert.rejects(service.invoke({ ...input, operation: "transcripts.get", input: { id: "missing" } }), { code: "connector_response_invalid" });
  state.response = entry.operationResponse;
  await service.invoke({ ...input, operation: "transcripts.search", input: { keyword: "appointment", skip: 25 } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { keyword: "appointment", scope: "all", limit: 25, skip: 25, mine: true });
  await assert.rejects(service.invoke({ ...input, operation: "transcripts.search", input: { keyword: "", scope: "arbitrary" } }), { code: "connector_input_invalid" });
  state.response = { ...entry.operationResponse, errors: [{ message: state.key }] };
  await assert.rejects(service.invoke({ ...input, operation: "transcripts.list" }), { code: "connector_response_invalid" });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).variables, { limit: 25, skip: 0, mine: true });
});

test("new read fragments preserve empty collections and reject invalid envelopes and boundaries", () => {
  const incidents = incidentIoProvider.operations["incidents.list"];
  assert.equal(incidents.validateResult({ incidents: [] }), true);
  assert.equal(incidents.validateResult({ incidents: [], pagination_meta: null }), false);
  assert.throws(() => incidents.request({ sort_by: "arbitrary" }));
  const initial = new URL(incidents.request({}).url);
  assert.equal(initial.searchParams.get("page_size"), "25");
  assert.equal(initial.searchParams.get("sort_by"), "created_at_newest_first");
  const balance = stripeProvider.operations["balance.read"];
  assert.equal(balance.validateResult({ object: "balance", available: [], pending: [], livemode: true }), true);
  assert.equal(balance.validateResult({ object: "balance", available: [], pending: [] }), false);
  assert.equal(balance.request({}).url, "https://api.stripe.com/v1/balance");
  const hardware = replicateProvider.operations["hardware.list"];
  assert.equal(hardware.validateResult([]), true);
  assert.equal(hardware.validateResult([null]), false);
  for (const skip of [-1, 2147483648]) assert.throws(() => firefliesProvider.operations["transcripts.list"].request({ skip }));
});


test("AI service readers distinguish authenticated checks and preserve provider paging fields", () => {
  assert.equal(perplexityProvider.checkOperation, "requests.list");
  assert.equal(perplexityProvider.operations["requests.list"].validateResult({ requests: [], next_token: null }), true);
  assert.equal(perplexityProvider.operations["requests.list"].validateResult({ object: "list", data: [] }), false);
  assert.equal(supabaseProvider.operations["projects.list"].validateResult([]), true);
  assert.equal(supabaseProvider.operations["projects.list"].validateResult([{ error: "no" }]), false);
  const voices = heygenProvider.operations["voices.list"];
  assert.equal(voices.validateResult({ data: [], has_more: false }), true);
  assert.equal(voices.validateResult({ data: [], has_more: "false" }), false);
  assert.throws(() => voices.request({ type: "arbitrary" }));
  assert.throws(() => voices.request({ gender: "arbitrary" }));
  const url = new URL(voices.request({}).url);
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.searchParams.get("type"), "public");
});

test("Ashby preserves incremental-sync state and rejects HTTP-success errors or broken cursors", async (t) => {
  const entry = cases.find((item) => item.provider === ashbyProvider);
  const { service, input, state, requests } = await fixture(t, entry);
  state.response = { success: false, errors: [state.key], errorInfo: { code: "next_cursor_expired", message: state.key } };
  await assert.rejects(service.connectApiKey(input), (error) => {
    assert.equal(error.code, "connector_provider_failed");
    assert.equal(error.message.includes(state.key), false);
    assert.equal(JSON.stringify(error).includes(state.key), false);
    return true;
  });
  assert.equal((await service.status(input)).status, "disconnected");
  state.response = entry.response;
  await service.connectApiKey(input);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { limit: 25 });
  const count = requests.length;
  for (const invalid of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { cursor: "" }, { cursor: "x".repeat(8193) }, { syncToken: "" }, { syncToken: "x".repeat(8193) }, { apiKey: "other" }, { url: "https://attacker.invalid" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "jobs.list", input: invalid }), { code: "connector_input_invalid" });
  }
  for (const key of ["key:password", "key with space", "key\nheader"]) {
    state.key = key;
    await assert.rejects(service.invoke({ ...input, operation: "jobs.list" }), { code: "connector_binding_missing" });
  }
  assert.equal(requests.length, count);
  state.key = "private-fixture-key";
  for (const response of [{ success: true, results: [] }, { ...entry.response, nextCursor: "" }, { ...entry.response, syncToken: {} }]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation: "jobs.list" }), { code: "connector_response_invalid" });
  }
  state.response = { success: true, results: [], moreDataAvailable: false, syncToken: "next-sync" };
  assert.deepEqual(await service.invoke({ ...input, operation: "jobs.list", input: { cursor: "next-cursor", syncToken: "current-sync" } }), state.response);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { limit: 25, cursor: "next-cursor", syncToken: "current-sync" });
  state.status = 403;
  state.response = { success: false, errors: ["missing_endpoint_permission"] };
  await assert.rejects(service.invoke({ ...input, operation: "jobs.list" }), { code: "connector_permission_denied" });
});

test("Lexware validates contact pages and role filters without accepting unsupported search or pagination values", async (t) => {
  const entry = cases.find((item) => item.provider === lexwareProvider);
  const { service, input, state, requests } = await fixture(t, entry);
  await service.connectApiKey(input);
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { page: "0", size: "25" });
  for (const invalid of [{ page: -1 }, { page: 1.5 }, { size: 0 }, { size: 251 }, { size: 1.5 }, { customer: "maybe" }, { vendor: [] }, { name: "A&B" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "contacts.list", input: invalid }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, 1);
  state.response = { content: [], first: true, last: true, totalPages: 0, totalElements: 0, numberOfElements: 0, size: 250, number: 0 };
  assert.deepEqual(await service.invoke({ ...input, operation: "contacts.list", input: { size: 250, customer: true, vendor: false } }), state.response);
  for (const response of [{ ...state.response, number: -1 }, { ...state.response, last: "true" }, { ...state.response, content: {} }, { ...state.response, size: 0 }]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation: "contacts.list" }), { code: "connector_response_invalid" });
  }
});

test("Lexware reads accounting resources and creates explicit draft invoices without replay", async (t) => {
  const entry = cases.find(item => item.provider === lexwareProvider);
  const { service, options, input, state, requests } = await fixture(t, entry);
  await service.connectApiKey(input);
  const id = "11111111-1111-4111-8111-111111111111";
  for (const resource of ["contacts", "articles", "invoices", "vouchers"]) {
    state.response = { id, version: 1 };
    assert.deepEqual(await service.invoke({ ...input, operation: `${resource}.get`, input: { id } }), state.response);
    assert.equal(requests.at(-1).url.pathname, `/v1/${resource}/${id}`);
  }
  state.response = { ...entry.response, content: [{ id }], number: 1, last: false };
  await service.invoke({ ...input, operation: "articles.list", input: { page: 1, type: "SERVICE" } });
  assert.equal(requests.at(-1).url.pathname, "/v1/articles");
  assert.equal(requests.at(-1).url.searchParams.get("type"), "SERVICE");
  await service.invoke({ ...input, operation: "vouchers.list", input: { voucherType: "invoice", voucherStatus: "open", contactId: id } });
  assert.equal(requests.at(-1).url.pathname, "/v1/voucherlist");
  assert.equal(requests.at(-1).url.searchParams.get("contactId"), id);
  const draft = { contactId: id, voucherDate: "2026-09-13T12:00:00+02:00", shippingDate: "2026-09-12T12:00:00+02:00", shippingType: "service",
    lineItems: [{ name: "Grooming", quantity: 1, unitName: "session", netAmount: 50, taxRatePercentage: 19 }], title: "Booking invoice" };
  state.response = { id, version: 1, resourceUri: "https://untrusted.invalid/not-followed" };
  await service.invoke({ ...input, operation: "invoices.createDraft", input: draft });
  const sent = requests.at(-1);
  assert.equal(sent.init.method, "POST");
  assert.equal(sent.url.href, "https://api.lexware.io/v1/invoices?finalize=false");
  const body = JSON.parse(sent.init.body);
  assert.deepEqual(body.address, { contactId: id });
  assert.deepEqual(body.taxConditions, { taxType: "net" });
  assert.deepEqual(body.lineItems[0].unitPrice, { currency: "EUR", netAmount: 50, taxRatePercentage: 19 });
  assert.equal(body.lineItems[0].type, "custom");
  const before = requests.length;
  for (const invalid of [{ ...draft, lineItems: [] }, { ...draft, finalize: true }, { ...draft, contactId: "../other" },
    { ...draft, voucherDate: "2026-02-30T00:00:00Z" }, { ...draft, lineItems: [{ ...draft.lineItems[0], netAmount: -1 }] },
    { ...draft, lineItems: [{ ...draft.lineItems[0], taxRatePercentage: 101 }] }, { ...draft, lineItems: [{ ...draft.lineItems[0], currency: "USD" }] }])
    await assert.rejects(service.invoke({ ...input, operation: "invoices.createDraft", input: invalid }), { code: "connector_input_invalid" });
  const restricted = createConnectionService({ ...options, authorize: async (owner, request) => request.operation === "invoices.createDraft" ? null : owner });
  await assert.rejects(restricted.invoke({ ...input, operation: "invoices.createDraft", input: draft }), { code: "connector_access_denied" });
  assert.equal(requests.length, before);
  state.response = {};
  await assert.rejects(service.invoke({ ...input, operation: "invoices.createDraft", input: draft }), { code: "connector_response_invalid" });
  for (const status of [403, 406, 429, 504]) {
    state.status = status; const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "invoices.createDraft", input: draft }));
    assert.equal(requests.length, count + 1);
  }
});

test("Sevdesk includes people by default, preserves numeric-string totals and bounds contact pagination", async (t) => {
  const entry = cases.find((item) => item.provider === sevdeskProvider);
  const { service, input, state, requests } = await fixture(t, entry);
  await service.connectApiKey(input);
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { limit: "100", offset: "0", countAll: "false", depth: "1" });
  for (const invalid of [{ limit: 0 }, { limit: 1001 }, { limit: 1.5 }, { offset: -1 }, { offset: 1.5 }, { depth: 2 }, { countAll: "maybe" }, { Authorization: "other-token" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "contacts.list", input: invalid }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, 1);
  for (const total of [undefined, "0", 0]) {
    state.response = { objects: [], ...(total === undefined ? {} : { total }) };
    assert.deepEqual(await service.invoke({ ...input, operation: "contacts.list", input: { limit: 1000, countAll: true, depth: 0 } }), state.response);
  }
  for (const response of [{ objects: {} }, { objects: [], total: -1 }, { objects: [], total: "-1" }, { objects: [], total: "unknown" }, { objects: [], total: 1.5 }]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation: "contacts.list" }), { code: "connector_response_invalid" });
  }
});

test("Apollo searches saved accounts with bounded pages and cannot substitute a public health reply", async (t) => {
  const entry = cases.find((entry) => entry.provider === apolloIoProvider);
  const { service, input, state, requests } = await fixture(t, entry);
  for (const response of [{ healthy: true, is_logged_in: false }, { organizations: [] }, { accounts: {} }]) {
    state.response = response;
    await assert.rejects(service.connectApiKey(input), { code: "connector_response_invalid" });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  state.response = entry.response;
  await service.connectApiKey(input);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { page: 1, per_page: 25 });
  assert.equal(requests.at(-1).headers.has("authorization"), false);
  const count = requests.length;
  for (const invalid of [{ page: 0 }, { page: 501 }, { page: 1.5 }, { per_page: 0 }, { per_page: 101 }, { per_page: 1.5 }, { q_organization_name: "" }, { q_organization_name: "x".repeat(257) }, { api_key: "other" }, { url: "https://attacker.invalid" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "accounts.search", input: invalid }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.response = { accounts: [], breadcrumbs: [] };
  assert.deepEqual(await service.invoke({ ...input, operation: "accounts.search", input: { page: 500, per_page: 100 } }), state.response);
});

test("Attention uses the current conversation listing and preserves partial metadata without following returned URLs", async (t) => {
  const entry = cases.find((entry) => entry.provider === attentionProvider);
  const { service, input, state, requests } = await fixture(t, entry);
  await service.connectApiKey(input);
  assert.deepEqual(Object.fromEntries(requests[0].url.searchParams), { page: "1", size: "20", detailedTranscript: "false" });
  for (const invalid of [{ page: 0 }, { page: 1.5 }, { size: 0 }, { size: 51 }, { size: 1.5 }, { detailedTranscript: "maybe" }, { "filter[title]": "" }, { "filter[title]": "x".repeat(501) }, { "filter[hide_internal]": [] }, { withCrmRecords: true }, { url: "https://attacker.invalid" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "conversations.list", input: invalid }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, 1);
  state.response = { data: [], meta: { totalRecords: 0 }, links: { related: "https://attacker.invalid" } };
  assert.deepEqual(await service.invoke({ ...input, operation: "conversations.list", input: { page: 3, size: 50 } }), state.response);
  assert.equal(requests.length, 2);
  assert.equal(requests.at(-1).url.origin, "https://api.attention.tech");
  state.response = { data: [] };
  assert.deepEqual(await service.invoke({ ...input, operation: "conversations.list" }), state.response);
  for (const response of [{ data: {} }, { data: [], meta: [] }, { data: [], meta: null }, { data: [], meta: { totalRecords: -1 } }, { data: [], meta: { pageCount: 1.5 } }]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation: "conversations.list" }), { code: "connector_response_invalid" });
  }
});


test("Telegram verifies bot identity without consuming updates and accepts polling webhook state", async (t) => {
  const entry = cases.find((entry) => entry.provider === telegramProvider);
  const { service, input, state, requests } = await fixture(t, entry);
  await service.connectApiKey(input);
  state.response = { ok: true, result: { url: "", has_custom_certificate: false, pending_update_count: 0 } };
  assert.deepEqual(await service.invoke({ ...input, operation: "webhook.read" }), state.response);
  for (const response of [
    { ok: true, result: { url: "", has_custom_certificate: false, pending_update_count: -1 } },
    { ok: true, result: { url: "", pending_update_count: 0 } }
  ]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation: "webhook.read" }), { code: "connector_response_invalid" });
  }
  const count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "getUpdates" }), { code: "connector_operation_unknown" });
  for (const invalid of [{ offset: 2 }, { token: "other" }, { url: "https://attacker.invalid" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "webhook.read", input: invalid }), { code: "connector_input_invalid" });
  }
  for (const key of ["123:has/slash", "123:has?query", "../token", "123:has space", "123:"]) {
    state.key = key;
    await assert.rejects(service.connectApiKey(input), { code: "connector_binding_invalid" });
  }
  assert.equal(requests.length, count);
  assert.ok(requests.every(({ url }) => ["/bot123456:fixture_token/getMe", "/bot123456:fixture_token/getWebhookInfo"].includes(url.pathname)));
});

test("Telegram rejects user identities and HTTP-200 failure envelopes without echoing descriptions", async (t) => {
  const entry = cases.find((entry) => entry.provider === telegramProvider);
  const { service, input, state } = await fixture(t, entry);
  for (const bot of [{ id: 12, is_bot: false, first_name: "User" }, { id: 1.5, is_bot: true, first_name: "Bot" }, { id: 12, is_bot: true }]) {
    state.response = { ok: true, result: bot };
    await assert.rejects(service.connectApiKey(input), { code: "connector_response_invalid" });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  state.response = entry.response;
  await service.connectApiKey(input);
  for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [400, "connector_provider_failed"], [401, "connector_reconnect_required"]]) {
    state.response = { ok: false, error_code: status, description: state.key, parameters: { retry_after: 10 } };
    await assert.rejects(service.invoke({ ...input, operation: "profile.read" }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.stack.includes(state.key), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("KLIPY validates clip search bounds, encodes its path key and rejects unsuccessful envelopes", async (t) => {
  const entry = cases.find((entry) => entry.provider === klipyProvider);
  const { service, input, state, requests } = await fixture(t, entry);
  state.key = "key /?#%";
  await service.connectApiKey(input);
  assert.equal(requests[0].url.pathname, "/api/v1/key%20%2F%3F%23%25/clips/trending");
  assert.equal(requests[0].url.search, "?page=1&per_page=24&content_filter=high");
  for (const invalid of [{}, { q: "" }, { q: "x".repeat(501) }, { q: "test", page: 0 }, { q: "test", page: 1.5 },
    { q: "test", per_page: 7 }, { q: "test", per_page: 51 }, { q: "test", per_page: 8.5 },
    { q: "test", locale: "en_US" }, { q: "test", customer_id: "" }, { q: "test", content_filter: "strict" },
    { q: "test", app_key: "another" }, { q: "test", url: "https://attacker.invalid" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "clips.search", input: invalid }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, 1);
  for (const key of [".", ".."]) {
    state.key = key;
    await assert.rejects(service.connectApiKey(input), { code: "connector_request_invalid" });
  }
  assert.equal(requests.length, 1);
  state.key = "replacement-key";
  state.response = { result: true, data: { data: [], next: false } };
  assert.deepEqual(await service.invoke({ ...input, operation: "clips.search", input: { q: "nothing" } }), state.response);
  for (const [response, code] of [
    [{ result: false, data: { data: [], message: state.key } }, "connector_provider_failed"],
    [{ result: true, data: [] }, "connector_response_invalid"],
    [{ result: true, data: { data: {} } }, "connector_response_invalid"]
  ]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation: "clips.trending" }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.stack.includes(state.key), false);
      return true;
    });
  }
});


test("KLIPY media families preserve embedding metadata and never fetch media", async (t) => {
  const entry = cases.find((entry) => entry.provider === klipyProvider);
  const { service, input, state, requests } = await fixture(t, entry);
  await service.connectApiKey(input);
  for (const family of ["gifs", "stickers", "emojis"]) {
    state.response = { result: true, data: { data: [
      { type: family, slug: "happy-dog", file: { hd: { webp: { url: "https://static.klipy.com/dog.webp?delivery=keep" } } } },
      { type: "ad", id: "ad-1", tracking: "preserve" }
    ], has_next: true, current_page: 2 } };
    for (const action of ["trending", "search"]) {
      const result = await service.invoke({ ...input, operation: `${family}.${action}`,
        input: { page: 2, per_page: 8, ...(action === "search" ? { q: "happy dog" } : {}) } });
      assert.deepEqual(result, state.response);
      const request = requests.at(-1);
      assert.equal(request.url.pathname, `/api/v1/${state.key}/${family}/${action}`);
      assert.equal(request.url.searchParams.get("page"), "2");
      assert.equal(request.url.searchParams.get("content_filter"), "high");
      if (action === "search") assert.equal(request.url.searchParams.get("q"), "happy dog");
    }
  }
  assert.equal(requests.length, 7);
  assert(requests.every(({ url }) => url.origin === "https://api.klipy.com"));
  await assert.rejects(service.invoke({ ...input, operation: "gifs.search", input: { q: "dog", per_page: 7 } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, 7);
});


test("Contentful uses the selected delivery space and rejects invalid settings before transport", async (t) => {
  const entry = cases.find(({ provider }) => provider === contentfulProvider);
  const { options, input, requests } = await fixture(t, entry);
  const configured = (settings) => ({ ...options, configuration: {
    ...options.configuration, integrations: { source: {
      ...options.configuration.integrations.source, settings
    } }
  } });
  for (const settings of [{}, { spaceId: "../other" }, { spaceId: "space-one", environmentId: "../../other" },
    { spaceId: "space-one", region: "elsewhere" }]) {
    assert.throws(() => createConnectionService(configured(settings)));
  }
  assert.equal(requests.length, 0);
  const service = createConnectionService(configured({ spaceId: "space-one", environmentId: "preview-2", region: "eu" }));
  await service.connectApiKey(input);
  assert.equal(requests[0].url.href, "https://cdn.eu.contentful.com/spaces/space-one/environments/preview-2/entries?limit=1&skip=0");
  assert.equal(requests[0].headers.get("authorization"), "Bearer private-fixture-key");
  assert.equal(requests[0].url.searchParams.has("access_token"), false);
  const operation = contentfulProvider.operations["entries.list"];
  assert.equal(operation.validateResult({ sys: { type: "Array" }, items: [{ sys: { type: "Entry", id: "entry-1" } }], total: 1, limit: 1, skip: 0 }), true);
  for (const items of [[null], [{ sys: { type: "Space", id: "space-one" } }]]) {
    assert.equal(operation.validateResult({ ...entry.response, items }), false);
  }
});


test("Contentful delivers published localized entries and linked assets without fetching returned URLs", async t => {
  const { service, input, state, requests } = await fixture(t, cases.find(({ provider }) => provider === contentfulProvider));
  await service.connectApiKey(input);
  const asset = { sys: { type: "Asset", id: "hero" }, fields: { file: { url: "//images.ctfassets.net/space/hero/photo.jpg" } } };
  const article = { sys: { type: "Entry", id: "article" }, fields: { title: { "en-US": "Published story" }, image: { sys: { type: "Link", linkType: "Asset", id: "hero" } } } };
  state.response = { sys: { type: "Array" }, items: [article], includes: { Asset: [asset] }, errors: [{ sys: { id: "notResolvable", type: "error" }, details: { id: "unpublished-link" } }], total: 3, skip: 0, limit: 1 };
  const invoke = (operation, values = {}) => service.invoke({ ...input, operation, input: values });
  assert.deepEqual(await invoke("entries.list", { locale: "*", include: 10, content_type: "article", order: "sys.createdAt", "sys.id": "article" }), state.response);
  assert.equal(requests.at(-1).url.searchParams.get("locale"), "*"); assert.equal(requests.at(-1).url.searchParams.get("include"), "10");
  state.response = { ...state.response, items: [], includes: {}, skip: 2 };
  assert.deepEqual(await invoke("entries.list", { skip: 2 }), state.response);
  for (const [operation, path, item] of [["entries.get", "entries/article", article], ["assets.get", "assets/hero", asset], ["contentTypes.get", "content_types/model", { sys: { type: "ContentType", id: "model" }, fields: [{ id: "title", type: "Text" }] }]]) {
    state.response = item; assert.deepEqual(await invoke(operation, { id: item.sys.id }), item);
    assert.equal(requests.at(-1).url.pathname, `/spaces/space-one/environments/master/${path}`);
  }
  for (const [operation, type] of [["assets.list", "Asset"], ["contentTypes.list", "ContentType"], ["locales.list", "Locale"]]) {
    state.response = { sys: { type: "Array" }, items: [{ sys: { type, id: "resource" } }], skip: 1, limit: 2, total: 3 };
    assert.deepEqual(await invoke(operation, { skip: 1, limit: 2 }), state.response);
  }
  assert(requests.every(request => request.init.method === "GET" && request.url.origin === "https://cdn.contentful.com"));
  const before = requests.length;
  for (const [operation, values] of [["entries.get", { id: "../outside" }], ["entries.list", { include: 11 }], ["assets.get", { id: "hero", url: "https://other.test" }]])
    await assert.rejects(invoke(operation, values), { code: "connector_input_invalid" });
  assert.equal(requests.length, before);
  state.response = { sys: { type: "Entry", id: "wrong-type" } };
  await assert.rejects(invoke("assets.get", { id: "hero" }), { code: "connector_response_invalid" });
  state.status = 404; await assert.rejects(invoke("entries.get", { id: "unpublished" }));
});


test("GatewayAPI sends regional SMS/RCS batches and verifies current Messaging callback signatures", async t => {
  const entry = cases.find(({ provider }) => provider === gatewayApiProvider);
  for (const region of ["global", "eu"]) {
    const { service, input, state, requests } = await fixture(t, { ...entry, settings: { region } });
    await service.connectApiKey(input);
    const message = { sender: "Bookings", recipient: 4512345678, message: "Ready", reference: "booking-one" };
    const receipt = { msg_id: "message-one", recipient: message.recipient, reference: message.reference };
    state.response = receipt;
    assert.deepEqual(await service.invoke({ ...input, operation: "messages.send", input: message }), receipt);
    assert.equal(requests.at(-1).url.href, `https://messaging.gatewayapi.${region === "eu" ? "eu" : "com"}/mobile/single`);
    assert.deepEqual(JSON.parse(requests.at(-1).init.body), { ...message, priority: "normal" });
    state.response = { responses: [receipt] };
    await service.invoke({ ...input, operation: "messages.sendBatch", input: { messages: [message] } });
    assert.equal(requests.at(-1).url.pathname, "/mobile/multi");
    const before = requests.length;
    for (const invalid of [{ ...message, recipient: -1 }, { ...message, reference: "" }, { ...message, sender: "TooLongSenderName" }]) await assert.rejects(service.invoke({ ...input, operation: "messages.send", input: invalid }), { code: "connector_input_invalid" });
    await assert.rejects(service.invoke({ ...input, operation: "messages.sendBatch", input: { messages: [] } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, before);
    state.response = { responses: [{}] };
    await assert.rejects(service.invoke({ ...input, operation: "messages.sendBatch", input: { messages: [message] } }), { code: "connector_response_invalid" });
    state.status = 500; const failedBefore = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "messages.send", input: message }), { code: "connector_provider_failed" });
    assert.equal(requests.length, failedBefore + 1);
  }
  const secret = "fixture-webhook-secret";
  for (const event_type of ["message.status.sms", "message.status.rcs", "user-message.text.sms", "user-message.text.rcs"]) {
    const event = { event_id: "event-one", timestamp: "2026-09-13T00:00:00Z", event_type, event: { msg_id: "message-one", reference: "booking-one", status: "DELIVERED" } };
    const rawBody = Buffer.from(JSON.stringify(event));
    const signature = "v1=" + createHmac("sha256", secret).update(rawBody).digest("hex");
    assert.deepEqual(verifyGatewayApiEvent({ rawBody, signature, secret }), event);
    for (const override of [{ secret: "wrong" }, { rawBody: Buffer.from("{}") }, { signature: "legacy.jwt.value" }]) assert.throws(() => verifyGatewayApiEvent({ rawBody, signature, secret, ...override }), { code: "connector_webhook_invalid" });
  }
});

test("HubSpot leads become linked deals and advance through a pipeline with app-owned policy", async t => {
  const entry = cases.find(item => item.provider.id === "hubspot");
  const f = await fixture(t, { ...entry, scopes: hubspotProvider.scopes.map(scope => scope.value) });
  const calls = [];
  const service = createConnectionService({ ...f.options,
    authorize: async (owner, request) => request.operation === "deals.update" && request.input.id !== "202" ? null : owner,
    fetchImpl: async (address, init) => {
      const url = new URL(address), body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, method: init.method, body });
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer private-fixture-key");
      if (url.pathname.includes("/pipelines/")) return Response.json({ results: [{ id: "sales", stages: [{ id: "qualified" }, { id: "won" }] }] });
      if (url.pathname.includes("/associations/default/")) return Response.json({ status: "COMPLETE", results: [{ from: { id: "202" }, to: { id: "101" } }] });
      if (init.method === "POST" || init.method === "PATCH") return Response.json({ id: url.pathname.includes("deals") ? "202" : "101", properties: body.properties });
      if (/\/[0-9]+$/u.test(url.pathname)) return Response.json({ id: url.pathname.split("/").at(-1), properties: { email: "customer@example.test" }, associations: { contacts: { results: [{ id: "101" }] } } });
      return Response.json({ results: [], paging: { next: { after: "next-page" } } });
    }
  });
  await service.connectApiKey(f.input);
  const invoke = (operation, input = {}) => service.invoke({ ...f.input, operation, input });
  const pipeline = (await invoke("pipelines.list")).results[0];
  const contact = await invoke("contacts.create", { properties: { email: "customer@example.test", firstname: "Customer" } });
  const deal = await invoke("deals.create", { properties: { dealname: "Grooming booking", pipeline: pipeline.id, dealstage: pipeline.stages[0].id, amount: "80.00" } });
  await invoke("deals.associateContact", { contactId: contact.id, dealId: deal.id });
  assert.equal(calls.at(-1).method, "PUT");
  assert.equal(calls.at(-1).url.pathname, "/crm/objects/2026-09/deals/202/associations/default/contacts/101");
  const advanced = await invoke("deals.update", { id: deal.id, properties: { dealstage: "won" } });
  assert.equal(advanced.properties.dealstage, "won");
  assert.equal(calls.at(-1).method, "PATCH");
  assert.deepEqual(calls.at(-1).body, { properties: { dealstage: "won" } });
  await invoke("contacts.update", { id: contact.id, properties: { phone: "" } });
  assert.deepEqual(calls.at(-1).body, { properties: { phone: "" } });
  const read = await invoke("deals.get", { id: deal.id, properties: "dealname,dealstage", associations: "contacts" });
  assert.equal(read.associations.contacts.results[0].id, contact.id);
  assert.equal(calls.at(-1).url.searchParams.get("properties"), "dealname,dealstage");
  await invoke("contacts.get", { id: contact.id });
  assert.equal((await invoke("deals.list", { after: "next & page", limit: 2 })).paging.next.after, "next-page");
  assert.equal(calls.at(-1).url.searchParams.get("after"), "next & page");
  const before = calls.length;
  for (const [operation, input] of [
    ["deals.update", { id: "999", properties: { amount: "1" } }],
    ["deals.create", { properties: { dealname: "Missing stage" } }],
    ["contacts.create", { properties: { phone: "123" } }],
    ["contacts.update", { id: "101", properties: { amount: 1 } }],
    ["contacts.get", { id: "../contacts" }],
    ["deals.associateContact", { contactId: "101/other", dealId: "202" }]
  ]) await assert.rejects(invoke(operation, input));
  assert.equal(calls.length, before);
  const limited = createConnectionService({ ...f.options, configuration: { ...f.options.configuration,
    integrations: { source: { ...f.options.configuration.integrations.source, scopes: ["crm.objects.contacts.read"] } } } });
  await assert.rejects(limited.invoke({ ...f.input, operation: "deals.create", input: { properties: { dealname: "Denied", dealstage: "won" } } }), { code: "connector_scope_missing" });
  assert.equal(hubspotProvider.operations["contacts.create"].validateResult({ status: "error" }), false);
  assert.equal(hubspotProvider.operations["deals.associateContact"].validateResult({}), false);
});

test("incident.io incident recovery covers follow-ups, alerts, schedules and catalogue with explicit writes", async t => {
  const f = await fixture(t, cases.find(item => item.provider.id === "incident-io"));
  const calls = [];
  let rejected = false;
  const service = createConnectionService({ ...f.options,
    authorize: async (owner, request) => request.operation === "alerts.resolve" && request.input.id !== "alert-one" ? null : owner,
    fetchImpl: async (address, init) => {
      const url = new URL(address), body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, method: init.method, body });
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer private-fixture-key");
      if (rejected) return Response.json({ message: "Private fixture detail" }, { status: 422 });
      const name = url.pathname.split("/")[2];
      const singular = { incidents: "incident", follow_ups: "follow_up", alerts: "alert", schedules: "schedule", catalog_entries: "catalog_entry" }[name];
      if (init.method !== "GET" || url.pathname.split("/").length > 3) return Response.json({ [singular]: { id: "resource-one", ...body } });
      return Response.json({ [name]: [{ id: "resource-one", ...(name === "schedules" ? { next_shifts: [{ user_id: "responder" }] } : {}) }], pagination_meta: { page_size: 25, after: "next-page" } });
    }
  });
  await service.connectApiKey(f.input);
  const invoke = (operation, input = {}) => service.invoke({ ...f.input, operation, input });
  const incident = await invoke("incidents.create", { name: "API unavailable", idempotency_key: "outage-event-one", visibility: "private", mode: "test" });
  assert.equal(incident.incident.id, "resource-one");
  assert.equal(calls.at(-1).body.idempotency_key, "outage-event-one");
  await invoke("incidents.update", { id: "resource-one", incident: { summary: "Recovered" }, notify_incident_channel: false });
  assert.deepEqual(calls.at(-1).body, { incident: { summary: "Recovered" }, notify_incident_channel: false });
  await invoke("followUps.create", { incident_id: "resource-one", title: "Add retry coverage", assignee_id: "responder" });
  await invoke("followUps.update", { id: "follow-one", title: "Add retry coverage", status: "completed" });
  assert.equal(calls.at(-1).method, "PUT");
  await invoke("followUps.list", { incident_id: "resource-one", incident_mode: "test" });
  assert.equal(calls.at(-1).url.searchParams.get("incident_mode"), "test");
  await invoke("alerts.resolve", { id: "alert-one" });
  assert.equal(calls.at(-1).url.pathname, "/v2/alerts/alert-one/actions/resolve");
  assert.equal(calls.at(-1).method, "POST");
  await invoke("alerts.list", { page_size: 50, after: "next & page" });
  assert.equal(calls.at(-1).url.searchParams.get("after"), "next & page");
  const schedules = await invoke("schedules.list");
  assert.equal(schedules.schedules[0].next_shifts[0].user_id, "responder");
  assert.equal(calls.at(-1).url.searchParams.get("page_size"), "25");
  await invoke("catalog.types");
  await invoke("catalog.list", { catalog_type_id: "services", identifier: "payments", after: "next" });
  const entry = { name: "Payments", external_id: "payments", attribute_values: { owner: { value: { literal: "team-one" } } } };
  await invoke("catalog.create", { catalog_type_id: "services", ...entry });
  assert.deepEqual(calls.at(-1).body.attribute_values, entry.attribute_values);
  await invoke("catalog.update", { id: "catalog-one", ...entry });
  assert.equal(calls.at(-1).method, "PUT");
  for (const operation of ["incidents.get", "followUps.get", "alerts.get", "schedules.get", "catalog.get"]) await invoke(operation, { id: "resource-one" });
  const before = calls.length;
  for (const [operation, input] of [
    ["incidents.create", { name: "No explicit visibility", idempotency_key: "one" }],
    ["incidents.update", { id: "one", incident: { summary: "No notification choice" } }],
    ["followUps.update", { id: "one", title: "task", status: "arbitrary" }],
    ["alerts.resolve", { id: "other-user" }], ["catalog.get", { id: "../keys" }],
    ["alerts.list", { page_size: 51 }], ["schedules.list", { page_size: 26 }],
    ["catalog.create", { catalog_type_id: "services", name: "Payments", attribute_values: { owner: { value: { literal: 42 } } } }]
  ]) await assert.rejects(invoke(operation, input));
  assert.equal(calls.length, before);
  rejected = true;
  await assert.rejects(invoke("alerts.resolve", { id: "alert-one" }), error => !JSON.stringify(error).includes("Private fixture detail"));
  assert.equal(calls.length, before + 1);
  for (const operation of ["incidents.create", "followUps.create", "alerts.resolve", "catalog.update"]) assert.equal(incidentIoProvider.operations[operation].validateResult({}), false);
});

test("Notion reads content and data sources then creates and updates a note with bounded writes", async t => {
  const { service, options, input, state, requests } = await fixture(t, cases.find(entry => entry.provider === notionProvider));
  await service.connectApiKey(input);
  const id = "d9824bdc-8445-4327-be8b-5b47500af6ce";
  const invoke = (operation, values = {}) => service.invoke({ ...input, operation, input: values });
  for (const [operation, object, collection] of [["pages.get", "page", "pages"], ["databases.get", "database", "databases"], ["dataSources.get", "data_source", "data_sources"]]) {
    state.response = { object, id, properties: { Name: { type: "title" } } };
    assert.deepEqual(await invoke(operation, { id }), state.response);
    assert.equal(requests.at(-1).url.pathname, `/v1/${collection}/${id}`);
  }
  state.response = { object: "list", results: [{ object: "block", id, has_children: true }], has_more: true, next_cursor: "next+cursor" };
  assert.deepEqual(await invoke("blocks.list", { id, start_cursor: "prior+&cursor", page_size: 2 }), state.response);
  assert.equal(requests.at(-1).url.searchParams.get("start_cursor"), "prior+&cursor");
  const filter = { property: "Done", checkbox: { equals: false } };
  await invoke("dataSources.query", { id, filter });
  assert.equal(requests.at(-1).url.pathname, `/v1/data_sources/${id}/query`);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { page_size: 100, filter });
  const properties = { Name: { title: [{ text: { content: "Meeting" } }] } };
  const children = [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: "Action" } }] } }];
  state.response = { object: "page", id, properties };
  await invoke("pages.create", { parentId: id, parentType: "data_source_id", properties, children });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { parent: { type: "data_source_id", data_source_id: id }, properties, children });
  await invoke("pages.update", { id, properties });
  assert.equal(requests.at(-1).init.method, "PATCH");
  state.response = { object: "list", results: children, has_more: false };
  await invoke("blocks.append", { id, children });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { children });
  const before = requests.length;
  for (const [op, values] of [["pages.get", { id: "../users" }], ["blocks.append", { id, children: [] }],
    ["blocks.append", { id, children: Array(101).fill(children[0]) }], ["pages.update", { id, properties: { x: "x".repeat(65536) } }]])
    await assert.rejects(invoke(op, values), { code: "connector_input_invalid" });
  const restricted = createConnectionService({ ...options, authorize: async (owner, request) => request.operation === "pages.create" ? null : owner });
  await assert.rejects(restricted.invoke({ ...input, operation: "pages.create", input: { parentId: id, parentType: "page_id", properties } }), { code: "connector_access_denied" });
  assert.equal(requests.length, before);
  for (const status of [403, 404, 429, 500]) { state.status = status; const count = requests.length; await assert.rejects(invoke("blocks.append", { id, children })); assert.equal(requests.length, count + 1); }
});

test("Pipedrive token CRM reads and writes use its configured company and preserve paging", async t => {
  const entry = cases.find(entry => entry.provider === pipedriveProvider);
  const { service, options, input, state, requests } = await fixture(t, { ...entry, settings: { companyDomain: "acme" } });
  await service.connectApiKey(input);
  const invoke = (operation, values = {}) => service.invoke({ ...input, operation, input: values });
  for (const collection of ["deals", "persons", "organizations", "activities", "leads", "pipelines"]) {
    const lead = collection === "leads";
    const id = lead ? "d9824bdc-8445-4327-be8b-5b47500af6ce" : 12;
    state.response = { success: true, data: [{ id }], additional_data: { next_cursor: "next+&2" } };
    assert.deepEqual(await invoke(`${collection}.list`, lead ? { start: 20, limit: 10 } : { cursor: "prior+&1", limit: 10 }), state.response);
    assert.equal(requests.at(-1).url.origin, "https://acme.pipedrive.com");
    assert.equal(requests.at(-1).url.pathname, `/api/${lead ? "v1" : "v2"}/${collection}`);
    assert.equal(requests.at(-1).headers.get("x-api-token"), state.key);
    state.response = { success: true, data: { id } };
    await invoke(`${collection}.get`, { id });
    if (collection === "pipelines") continue;
    const values = ["deals", "leads"].includes(collection) ? { title: "Follow-up", person_id: 1 }
      : collection === "activities" ? { subject: "Call", type: "call", done: false } : { name: "Customer" };
    await invoke(`${collection}.create`, values);
    assert.deepEqual(JSON.parse(requests.at(-1).init.body), values);
    await invoke(`${collection}.update`, { id, ...values }); assert.equal(requests.at(-1).init.method, "PATCH");
  }
  const count = requests.length;
  for (const [op, values] of [["deals.get", { id: "../other" }], ["leads.create", { title: "No contact" }], ["deals.update", { id: 1 }], ["persons.create", { name: "X", emails: Array(21).fill({ value: "x@y.test" }) }]])
    await assert.rejects(invoke(op, values), { code: "connector_input_invalid" });
  const denied = createConnectionService({ ...options, authorize: async (owner, request) => request.operation === "deals.create" ? null : owner });
  await assert.rejects(denied.invoke({ ...input, operation: "deals.create", input: { title: "Denied" } }), { code: "connector_access_denied" });
  assert.equal(requests.length, count);
  for (const status of [403, 429, 500]) { state.status = status; const before = requests.length; await assert.rejects(invoke("deals.create", { title: "Explicit" })); assert.equal(requests.length, before + 1); }
});

test("Replicate submits, polls and cancels model predictions without losing media or text outputs", async t => {
  const entry = cases.find(entry => entry.provider === replicateProvider);
  const { service, options, input, state, requests } = await fixture(t, entry);
  await service.connectApiKey(input);
  const invoke = (operation, values = {}) => service.invoke({ ...input, operation, input: values });
  state.response = { owner: "fixture", name: "model", latest_version: { id: "a".repeat(64), openapi_schema: { components: { schemas: { Input: { properties: { prompt: { type: "string" } } } } } } } };
  assert.deepEqual(await invoke("models.get", { owner: "fixture", name: "model" }), state.response);
  assert.equal(requests.at(-1).url.pathname, "/v1/models/fixture/model");
  state.response = { id: "job1", status: "starting", output: null };
  const modelInput = { prompt: "A garden", image: "https://files.example.test/input.png", count: 2 };
  await invoke("predictions.create", { version: "a".repeat(64), input: modelInput });
  assert.equal(requests.at(-1).url.pathname, "/v1/predictions");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { version: "a".repeat(64), input: modelInput });
  await invoke("models.predict", { owner: "fixture", name: "model", input: modelInput });
  assert.equal(requests.at(-1).url.pathname, "/v1/models/fixture/model/predictions");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { input: modelInput });
  for (const output of ["Generated text", ["https://files.example.test/image.png"], "https://files.example.test/video.mp4", { audio: "https://files.example.test/audio.wav" }]) {
    state.response = { id: "job1", status: "succeeded", output, metrics: { predict_time: 2 } };
    assert.deepEqual(await invoke("predictions.get", { id: "job1" }), state.response);
    assert.equal(requests.at(-1).url.pathname, "/v1/predictions/job1");
  }
  for (const status of ["processing", "failed", "canceled"]) {
    state.response = { id: "job1", status, output: null, error: status === "failed" ? "Model input failed" : null };
    assert.deepEqual(await invoke(status === "canceled" ? "predictions.cancel" : "predictions.get", { id: "job1" }), state.response);
  }
  assert.equal(requests.at(-1).init.method, "POST");
  assert.equal(requests.at(-1).url.pathname, "/v1/predictions/job1/cancel");
  const count = requests.length;
  for (const [op, values] of [["predictions.get", { id: "../other" }], ["models.predict", { owner: "fixture", name: "model", input: { prompt: "x".repeat(262145) } }], ["predictions.create", { version: "unversioned", input: {} }]])
    await assert.rejects(invoke(op, values), { code: "connector_input_invalid" });
  const denied = createConnectionService({ ...options, authorize: async (owner, request) => request.operation === "predictions.cancel" ? null : owner });
  await assert.rejects(denied.invoke({ ...input, operation: "predictions.cancel", input: { id: "job1" } }), { code: "connector_access_denied" });
  assert.equal(requests.length, count);
  for (const status of [403, 429, 500]) { state.status = status; const before = requests.length; await assert.rejects(invoke("models.predict", { owner: "fixture", name: "model", input: {} })); assert.equal(requests.length, before + 1); }
});
