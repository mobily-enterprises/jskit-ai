import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { geminiEnterpriseProvider } from "../src/server/gemini-enterprise.js";

const scope = "https://www.googleapis.com/auth/cloud-platform";
const context = { applicationId: "app-one", subjectId: "owner-one" };
const args = { context, integrationId: "enterprise-search" };
const callback = "https://app.example.test/oauth/gemini-enterprise/callback";
const searchPage = { results: [{ id: "policy", document: { id: "policy", structData: { title: "Holiday policy" } } }], totalSize: 2, attributionToken: "search-reference", nextPageToken: "next+/=&" };

async function fixture(t, { location = "global", accountMode = "shared" } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "gemini-enterprise-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configuration = { schemaVersion: 1, registrations: { google: { source: "own", clientId: "fixture-google-client",
    clientSecretRef: "env:GEMINI_SECRET", callbackUrlRef: "env:GEMINI_CALLBACK" } }, integrations: {
    "enterprise-search": { provider: "gemini-enterprise", accountMode, settings: { projectId: "my-gcp-project", location, engineId: "company_search-1" },
      scopes: [scope], authentication: { method: "oauth2", registrationRef: "google" } }
  } };
  const engine = { name: `projects/123456789012/locations/${location}/collections/default_collection/engines/company_search-1`, displayName: "Company search" };
  const state = { time: Date.now(), count: 0, value: undefined, status: 200, tokenPatch: {}, tokenStatus: 200, hang: false };
  const requests = [];
  const options = { configuration, providers: [{ ...geminiEnterpriseProvider, requestTimeoutMs: 60 }], authorize: async (owner) => owner,
    now: () => state.time, resolveReference: async (ref) => {
      if (ref === "env:GEMINI_SECRET") return "private-client-secret";
      assert.equal(ref, "env:GEMINI_CALLBACK"); return callback;
    },
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current" }) }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)); requests.push({ url, init });
      const headers = new Headers(init.headers);
      if (url.href === "https://oauth2.googleapis.com/token") {
        assert.equal(init.method, "POST"); const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), "fixture-google-client"); assert.equal(body.get("client_secret"), "private-client-secret");
        if (body.get("grant_type") === "authorization_code") {
          assert.equal(body.get("redirect_uri"), callback); assert.equal(body.get("code"), "private-code"); assert.ok(body.get("code_verifier"));
        } else {
          assert.equal(body.get("grant_type"), "refresh_token"); assert.equal(body.get("refresh_token"), `private-refresh-${state.count}`);
        }
        state.count++;
        return Response.json(state.tokenStatus === 200 ? { access_token: `private-access-${state.count}`, token_type: "Bearer", expires_in: 120,
          refresh_token: `private-refresh-${state.count}`, scope, ...state.tokenPatch } : { error: "invalid_grant", message: "private-provider-error" }, { status: state.tokenStatus });
      }
      assert.equal(url.origin, `https://${location === "global" ? "" : `${location}-`}discoveryengine.googleapis.com`);
      const expected = `/v1/projects/my-gcp-project/locations/${location}/collections/default_collection/engines/company_search-1`;
      assert.equal(url.pathname, init.method === "POST" ? `${expected}/servingConfigs/default_serving_config:search` : expected);
      assert.equal(init.redirect, "error"); assert.equal(headers.get("authorization"), `Bearer private-access-${state.count}`);
      assert.equal(init.credentials, "omit"); assert.equal(url.search, "");
      if (init.method === "POST") assert.ok(headers.get("content-type").includes("application/json")); else assert.equal(init.method, "GET");
      if (state.hang) return new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Missing abort")), 1000);
        const abort = () => { clearTimeout(timer); reject(init.signal.reason); };
        if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
      });
      if (state.status === 204) return new Response(null, { status: 204 });
      if (typeof state.value === "string") return new Response(state.value, { status: state.status });
      return Response.json(state.value === undefined ? init.method === "POST" ? searchPage : engine : state.value, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  const start = async () => {
    const { authorizationUrl } = await service.beginAuthorization(args); const url = new URL(authorizationUrl);
    const returned = new URL(callback); returned.searchParams.set("state", url.searchParams.get("state")); returned.searchParams.set("code", "private-code");
    return { url, callbackUrl: returned.href };
  };
  const connect = async () => service.completeAuthorization({ ...args, callbackUrl: (await start()).callbackUrl });
  return { directory, options, service, requests, state, engine, start, connect };
}

test("Gemini Enterprise uses Google PKCE consent and the configured regional engine, with encrypted restartable storage", async (t) => {
  for (const location of ["global", "us", "eu"]) {
    const f = await fixture(t, { location, accountMode: location === "eu" ? "assistant" : "shared" }); const start = await f.start();
    assert.equal(start.url.origin + start.url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(start.url.searchParams.get("scope"), scope); assert.equal(start.url.searchParams.get("access_type"), "offline");
    assert.equal(start.url.searchParams.get("prompt"), "consent"); assert.equal(start.url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(start.url.searchParams.has("client_secret"), false);
    await f.service.completeAuthorization({ ...args, callbackUrl: start.callbackUrl });
    const restarted = createConnectionService(f.options);
    assert.equal((await restarted.status(args)).status, "connected");
    assert.deepEqual(await restarted.invoke({ ...args, operation: "engine.get" }), f.engine);
    for (const file of await readdir(f.directory)) {
      const value = await readFile(path.join(f.directory, file), "utf8");
      for (const secret of ["private-code", "private-client-secret", "private-access-1", "private-refresh-1"]) assert.equal(value.includes(secret), false);
    }
  }
});

test("Gemini Enterprise search sends bounded JSON pages and preserves results, opaque cursors and redirect data", async (t) => {
  const f = await fixture(t); await f.connect();
  assert.deepEqual(await f.service.invoke({ ...args, operation: "search", input: { query: "holiday policy & travel" } }), searchPage);
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), { query: "holiday policy & travel", pageSize: 10 });
  const input = { query: "holiday policy & travel", pageSize: 25, pageToken: "next+/=&" };
  await f.service.invoke({ ...args, operation: "search", input }); assert.deepEqual(JSON.parse(f.requests.at(-1).init.body), input);
  for (const value of [{ attributionToken: "empty" }, { results: [], totalSize: 0, attributionToken: "empty", nextPageToken: "" },
    { attributionToken: "redirect", redirectUri: "https://elsewhere.example.test/result" }]) {
    f.state.value = value; assert.deepEqual(await f.service.invoke({ ...args, operation: "search", input: { query: "empty" } }), value);
  }
  assert.equal(f.requests.length, 7);
});

test("Gemini Enterprise rejects caller target and identity overrides, invalid page input and unauthorized scopes before transport", async (t) => {
  const f = await fixture(t); await f.connect(); const count = f.requests.length;
  for (const input of [{}, { query: "" }, { query: "x".repeat(4097) }, { query: "x", pageSize: 0 }, { query: "x", pageSize: 26 },
    { query: "x", pageSize: 1.5 }, { query: "x", pageToken: "" }, { query: "x", pageToken: "a".repeat(16001) },
    { query: "x", projectId: "other-project" }, { query: "x", userInfo: { userId: "someone" } }, { query: "x", servingConfig: "other" }]) {
    await assert.rejects(f.service.invoke({ ...args, operation: "search", input }));
  }
  await assert.rejects(f.service.invoke({ ...args, operation: "engine.get", input: { engineId: "other" } }));
  const denied = createConnectionService({ ...f.options, authorize: async () => { throw new Error("Denied by host"); } });
  await assert.rejects(denied.invoke({ ...args, operation: "engine.get" }), /Denied by host/u);
  assert.equal(f.requests.length, count);
  const narrowed = await fixture(t); narrowed.state.tokenPatch.scope = "https://www.googleapis.com/auth/other";
  await assert.rejects(narrowed.connect(), { code: "connector_scope_missing" }); assert.equal(narrowed.requests.length, 1);
});

test("Gemini Enterprise binds stored grants and pending consent to their application, owner and settings", async (t) => {
  const f = await fixture(t); await f.connect(); const count = f.requests.length;
  for (const owner of [{ ...context, applicationId: "other" }, { ...context, subjectId: "other" }]) {
    await assert.rejects(f.service.invoke({ ...args, context: owner, operation: "engine.get" }), { code: "connector_reconnect_required" });
  }
  for (const [key, value] of [["projectId", "another-project"], ["location", "eu"], ["engineId", "another-engine"]]) {
    const configuration = structuredClone(f.options.configuration); configuration.integrations["enterprise-search"].settings[key] = value;
    const changed = createConnectionService({ ...f.options, configuration });
    assert.equal((await changed.status(args)).status, "reconnect-required");
    await assert.rejects(changed.invoke({ ...args, operation: "engine.get" }), { code: "connector_reconnect_required" });
    const start = await f.start(); await assert.rejects(changed.completeAuthorization({ ...args, callbackUrl: start.callbackUrl }), { code: "connector_attempt_invalid" });
  }
  assert.equal(f.requests.length, count);
});

test("Gemini Enterprise refreshes rotated grants, keeps Google scopes bounded and reports missing or revoked refresh access", async (t) => {
  const f = await fixture(t); await f.connect(); f.state.time += 121_000;
  f.state.tokenPatch.scope = `${scope} https://www.googleapis.com/auth/drive`;
  await f.service.invoke({ ...args, operation: "engine.get" });
  assert.deepEqual((await f.service.status(args)).grantedScopes, [scope]);
  f.state.time += 121_000; f.state.tokenStatus = 400;
  await assert.rejects(f.service.invoke({ ...args, operation: "engine.get" }), { code: "connector_reconnect_required" });
  const short = await fixture(t); short.state.tokenPatch.refresh_token = undefined; await short.connect(); short.state.time += 121_000;
  await assert.rejects(short.service.invoke({ ...args, operation: "engine.get" }), { code: "connector_reconnect_required" }); assert.equal(short.requests.length, 2);
});

test("Gemini Enterprise consumes denied, cancelled and replayed attempts without destroying earlier access", async (t) => {
  const f = await fixture(t); await f.connect();
  const denied = await f.start(); const url = new URL(denied.callbackUrl); url.searchParams.delete("code"); url.searchParams.set("error", "access_denied");
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: url.href }), { code: "connector_consent_denied" });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: denied.callbackUrl }), { code: "connector_attempt_invalid" });
  const cancelled = await f.start(); await f.service.cancelAuthorization({ ...args, state: cancelled.url.searchParams.get("state") });
  await assert.rejects(f.service.completeAuthorization({ ...args, callbackUrl: cancelled.callbackUrl }), { code: "connector_attempt_invalid" });
  assert.equal((await f.service.status(args)).status, "connected"); assert.equal(f.requests.length, 2);
});

test("Gemini Enterprise rejects malformed metadata and result envelopes without treating them as verified access", async (t) => {
  for (const value of [null, {}, [], { error: { message: "private" } }, { name: "engine", displayName: "Company" }, { name: "projects/123/locations/global/collections/default_collection/engines/engine" }]) {
    const f = await fixture(t); f.state.value = value;
    await assert.rejects(f.connect(), { code: "connector_response_invalid" }); assert.equal((await f.service.status(args)).status, "disconnected");
  }
  const f = await fixture(t); await f.connect();
  for (const value of [null, {}, [], { attributionToken: "" }, { attributionToken: "a", results: null }, { attributionToken: "a", results: [{}] },
    { attributionToken: "a", results: [{ id: "a", document: null }] }, { attributionToken: "a", totalSize: -1 }, { attributionToken: "a", nextPageToken: 1 },
    { attributionToken: "a", redirectUri: {} }, { attributionToken: "a", error: {} }, { ...searchPage, results: Array(26).fill(searchPage.results[0]) }, "<html>private-error</html>"]) {
    f.state.value = value; await assert.rejects(f.service.invoke({ ...args, operation: "search", input: { query: "query" } }), { code: "connector_response_invalid" });
  }
});

test("Gemini Enterprise sanitizes API failures, aborts pending requests and disconnects locally", async (t) => {
  const f = await fixture(t); await f.connect();
  for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    f.state.status = status; f.state.value = { error: { message: "private-provider-error" } };
    await assert.rejects(f.service.invoke({ ...args, operation: "search", input: { query: "query" } }), (error) => error.code === code && !error.message.includes("private"));
  }
  f.state.hang = true; const controller = new AbortController();
  const pending = f.service.invoke({ ...args, operation: "engine.get", signal: controller.signal }); setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, { code: "connector_cancelled" });
  await assert.rejects(f.service.invoke({ ...args, operation: "engine.get" }), { code: "connector_provider_timeout" });
  f.state.hang = false; f.state.status = 401;
  await assert.rejects(f.service.invoke({ ...args, operation: "engine.get" }), { code: "connector_reconnect_required" });
  await f.service.disconnect(args); assert.equal((await f.service.status(args)).status, "disconnected");
});

test("Gemini Enterprise guide and CLI share identifier, location, permission and reference validation", async () => {
  const guide = await readFile(new URL("../docs/gemini-enterprise.md", import.meta.url), "utf8");
  const config = JSON.parse([...guide.matchAll(/```json\n([\s\S]*?)\n```/gu)][0][1]);
  const parse = (value) => parseIntegrationConfiguration(JSON.stringify(value), { providers: [geminiEnterpriseProvider] });
  assert.deepEqual(parse(config), config);
  for (const [key, values] of Object.entries({ projectId: ["", "123456789012", "My-Project", "my-project/other", "my-project ", "a".repeat(31)],
    engineId: ["", "-bad", "UPPER", "engine/../other", "a".repeat(64)], location: ["", "https://attacker.test", "ca", "US"] })) {
    for (const value of values) {
      const invalid = structuredClone(config); invalid.integrations["enterprise-search"].settings[key] = value;
      assert.throws(() => parse(invalid), (error) => Boolean(error.fieldErrors[`integrations.enterprise-search.settings.${key}`]));
    }
  }
  for (const [key, value] of [["clientSecretRef", "private-secret"], ["callbackUrlRef", callback], ["tokenEndpointAuthMethod", "none"]]) {
    const invalid = structuredClone(config); invalid.registrations["google-search"][key] = value;
    assert.throws(() => parse(invalid), (error) => Boolean(error.fieldErrors[`registrations.google-search.${key}`]));
  }
  const unsupported = structuredClone(config); unsupported.integrations["enterprise-search"].accountMode = "per-user";
  assert.throws(() => parse(unsupported));
});


test("Gemini Enterprise returns source snippets and cited provider summaries only when explicitly requested", async t => {
  const f = await fixture(t); await f.connect();
  const value = { ...searchPage, results: [{ id: "policy", document: { id: "policy", derivedStructData: { title: "Holiday policy", link: "https://company.example/policy", snippets: [{ snippet: "Request leave a week ahead.", snippet_status: "SUCCESS" }] } } }], summary: { summaryText: "Request leave a week ahead. [1]" } };
  f.state.value = value;
  const contentSearchSpec = { snippetSpec: { returnSnippet: true }, summarySpec: { summaryResultCount: 3 } };
  const result = await f.service.invoke({ ...args, operation: "search", input: { query: "How do I request leave?", contentSearchSpec } });
  assert.equal(result.summary.summaryText, value.summary.summaryText);
  assert.equal(result.results[0].document.derivedStructData.snippets[0].snippet, "Request leave a week ahead.");
  assert.deepEqual(JSON.parse(f.requests.at(-1).init.body).contentSearchSpec.summarySpec, { summaryResultCount: 3, includeCitations: true, ignoreAdversarialQuery: true, ignoreNonSummarySeekingQuery: true, ignoreLowRelevantContent: true });
  f.state.value = { attributionToken: "none", summary: { summarySkippedReasons: ["NO_RELEVANT_CONTENT"] } };
  assert.deepEqual((await f.service.invoke({ ...args, operation: "search", input: { query: "unavailable", contentSearchSpec } })).summary.summarySkippedReasons, ["NO_RELEVANT_CONTENT"]);
  await assert.rejects(f.service.invoke({ ...args, operation: "search", input: { query: "q", contentSearchSpec: { summarySpec: { summaryResultCount: 11 } } } }));
});
