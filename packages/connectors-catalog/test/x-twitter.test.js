import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService, ConnectorError } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { xTwitterProvider } from "../src/server/x-twitter.js";

const context = { applicationId: "research-app", subjectId: "research-team" };
const input = { context, integrationId: "social" };
const verification = { ...input, verificationInput: { username: "Example" } };
const profile = { data: { id: "1234567890123456789", name: "Example", username: "example" } };
const page = { data: [{ id: "1934567890123456789", text: "A public post" }], meta: { result_count: 1, next_token: "opaque-cursor" } };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "x-twitter-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current" });
  const requests = [];
  const state = { key: "fixture%2Fapp-token", status: 200, response: profile, wait: false, resolutions: 0 };
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { social: {
      provider: "x-twitter", displayName: "Public research", accountMode: "shared", scopes: [],
      authentication: { method: "api-key", secretRef: "env:X_APP_BEARER_TOKEN" }, extensions: { fromCli: true }
    } }, extensions: { preserved: true } },
    providers: [xTwitterProvider], authorize: async (owner) => owner,
    store: createFileConnectionStore({ directory, protection }),
    resolveReference: async (ref) => { state.resolutions++; assert.equal(ref, "env:X_APP_BEARER_TOKEN"); return state.key; },
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

test("X verifies public lookup using an app token and preserves file ownership, rotation and disconnect", async (t) => {
  assert.deepEqual(xTwitterProvider.verificationFields.filter((field) => field.required).map((field) => field.name), Object.keys(verification.verificationInput));
  const { service, options, requests, directory, protection, state } = await fixture(t);
  const connected = await service.connectApiKey(verification);
  assert.equal(connected.status, "connected");
  assert.equal(requests[0].url.href, "https://api.x.com/2/users/by/username/Example?user.fields=description%2Cprofile_image_url%2Cpublic_metrics");
  assert.equal(requests[0].init.method, "GET"); assert.equal(requests[0].init.body, undefined);
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].headers.get("authorization"), `Bearer ${state.key}`);
  for (const name of await readdir(directory)) {
    const stored = await readFile(path.join(directory, name), "utf8");
    assert.doesNotThrow(() => JSON.parse(stored)); assert.equal(stored.includes(state.key), false);
  }
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.status(input), connected);
  state.key = "rotated-app-token";
  assert.deepEqual(await restarted.invoke({ ...input, operation: "users.lookup", input: { username: "example" } }), profile);
  assert.equal(requests.at(-1).headers.get("authorization"), "Bearer rotated-app-token");
  for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-team" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "users.lookup", input: { username: "example" } }), { code: "connector_reconnect_required" });
  }
  assert.equal(requests.length, 2);
  await restarted.disconnect(input);
  assert.equal((await service.status(input)).status, "disconnected");
  assert.equal(requests.length, 2);
});

test("X configuration accepts token references for shared and assistant access without OAuth or user login", async (t) => {
  const { service, options, state, requests } = await fixture(t);
  const parse = (configuration) => parseIntegrationConfiguration(JSON.stringify(configuration), { providers: [xTwitterProvider] });
  const parsed = parse(options.configuration);
  assert.deepEqual(parsed.extensions, { preserved: true }); assert.deepEqual(parsed.integrations.social.extensions, { fromCli: true });
  for (const accountMode of ["shared", "assistant"]) {
    const configuration = structuredClone(options.configuration); configuration.integrations.social.accountMode = accountMode;
    assert.equal(parse(configuration).integrations.social.accountMode, accountMode);
  }
  for (const change of [
    { authentication: { method: "api-key", secretRef: "raw-token" } },
    { authentication: { method: "api-key", secretRef: "https://example.test/token" } },
    { authentication: { method: "api-key" } }, { accountMode: "per-user" },
    { authentication: { method: "oauth2", registrationRef: "x" } }, { scopes: ["tweet.read"] }
  ]) {
    const configuration = structuredClone(options.configuration); Object.assign(configuration.integrations.social, change);
    assert.throws(() => parse(configuration), (error) => Boolean(error.fieldErrors));
  }
  for (const key of ["", "Bearer token", "key\nheader", "key\u0000", "é", "a".repeat(8193)]) {
    state.key = key; await assert.rejects(service.connectApiKey(verification), { code: "connector_binding_missing" });
  }
  assert.equal(requests.length, 0);
});

test("X requires an explicit verification username and rejects injected lookup paths or request options", async (t) => {
  const { service, requests } = await fixture(t);
  for (const values of [{}, ...["", "@example", " example", "example ", "a".repeat(16), "../me", "https://example.test", "a?x=y"].map((username) => ({ username })),
    { username: "example", url: "https://other.test" }, { username: "example", headers: { Authorization: "other" } }]) {
    await assert.rejects(service.connectApiKey({ ...input, verificationInput: values }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, 0); assert.equal((await service.status(input)).status, "disconnected");
  await service.connectApiKey(verification);
  for (const operation of ["users.me", "posts.create", "messages.send"]) {
    await assert.rejects(service.invoke({ ...input, operation }), { code: "connector_operation_unknown" });
  }
  assert.equal(requests.length, 1);
});

test("X public post pages preserve large string IDs and explicit opaque cursors, including empty timelines", async (t) => {
  const { service, state, requests } = await fixture(t);
  await service.connectApiKey(verification); state.response = page;
  const operation = { ...input, operation: "users.posts" };
  assert.deepEqual(await service.invoke({ ...operation, input: { userId: profile.data.id } }), page);
  assert.equal(requests.at(-1).url.href, `https://api.x.com/2/users/${profile.data.id}/tweets?max_results=10`);
  for (const maxResults of [5, 100]) {
    await service.invoke({ ...operation, input: { userId: profile.data.id, maxResults, paginationToken: "opaque+/=cursor" } });
    assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { max_results: String(maxResults), pagination_token: "opaque+/=cursor" });
  }
  const count = requests.length;
  for (const values of [
    ...[undefined, 123, Number(profile.data.id), "", "1".repeat(20), "../me", "12?x=y", " 12"].map((userId) => ({ userId })),
    ...[4, 101, 5.5].map((maxResults) => ({ userId: profile.data.id, maxResults })),
    ...["", "bad\n", "a".repeat(4097)].map((paginationToken) => ({ userId: profile.data.id, paginationToken })),
    { userId: profile.data.id, url: "https://other.test" }
  ]) await assert.rejects(service.invoke({ ...operation, input: values }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  for (const response of [{ meta: { result_count: 0 } }, { data: [], meta: { result_count: 0 } }]) {
    state.response = response;
    assert.deepEqual(await service.invoke({ ...operation, input: { userId: profile.data.id } }), response);
  }
  assert.equal(requests.length, count + 2);
});

test("X rejects malformed profiles, post envelopes, pagination and lossy IDs", async (t) => {
  const { service, state } = await fixture(t);
  for (const response of [null, [], {}, { errors: {} }, { ...profile, errors: {} },
    ...[{ id: Number(profile.data.id) }, { username: "someone_else" }, { name: null }, { username: "@example" }].map((change) => ({ data: { ...profile.data, ...change } }))]) {
    state.response = response;
    await assert.rejects(service.connectApiKey(verification), { code: "connector_response_invalid" });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  state.response = profile; await service.connectApiKey(verification);
  for (const response of [{}, { ...page, data: {} }, { meta: { result_count: 1 } }, { ...page, errors: {} },
    ...[{ result_count: "1" }, { result_count: 2 }, { result_count: -1 }, { next_token: "" }, { previous_token: "bad\n" }, { newest_id: 123 }].map((change) => ({ ...page, meta: { ...page.meta, ...change } })),
    { data: Array(11).fill(page.data[0]), meta: { result_count: 11 } },
    ...[{ id: Number(page.data[0].id) }, { id: "1".repeat(20) }, { text: null }].map((change) => ({ ...page, data: [{ ...page.data[0], ...change }] }))]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation: "users.posts", input: { userId: profile.data.id } }), { code: "connector_response_invalid" });
  }
});

test("X partial successes and unavailable lookup results never establish a false connection", async (t) => {
  const { service, state } = await fixture(t);
  for (const [response, code] of [
    [{ errors: [{ type: "https://api.x.com/2/problems/resource-not-found", detail: state.key }] }, "connector_resource_not_found"],
    [{ errors: [{ type: "https://api.twitter.com/2/problems/resource-not-found" }] }, "connector_resource_not_found"],
    [{ ...profile, errors: [{ detail: state.key }] }, "connector_response_incomplete"],
    [{ errors: [{ type: "unknown", detail: state.key }] }, "connector_response_incomplete"]
  ]) {
    state.response = response;
    await assert.rejects(service.connectApiKey(verification), (error) => error.code === code && !JSON.stringify(error).includes(state.key));
    assert.equal((await service.status(input)).status, "disconnected");
  }
  state.response = { ...profile, errors: [] }; await service.connectApiKey(verification);
  state.response = { ...page, errors: [{ detail: state.key }] };
  await assert.rejects(service.invoke({ ...input, operation: "users.posts", input: { userId: profile.data.id } }), { code: "connector_response_incomplete" });
});

test("X transport errors distinguish billing, missing resources, access and capacity without disclosing provider messages", async (t) => {
  const { service, state, requests } = await fixture(t);
  for (const [status, code] of [[401, "connector_reconnect_required"], [402, "connector_billing_required"], [403, "connector_permission_denied"],
    [404, "connector_resource_not_found"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status; state.response = { detail: state.key };
    const count = requests.length;
    await assert.rejects(service.connectApiKey(verification), (error) => error.code === code && !JSON.stringify(error).includes(state.key));
    assert.equal(requests.length, count + 1); assert.equal((await service.status(input)).status, "disconnected");
  }
  state.status = 200; state.response = profile; await service.connectApiKey(verification);
  state.status = 401;
  await assert.rejects(service.invoke({ ...input, operation: "users.lookup", input: { username: "example" } }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("X host authorization precedes token resolution and API calls", async (t) => {
  const { service, options, state, requests } = await fixture(t);
  await service.connectApiKey(verification);
  const denied = createConnectionService({ ...options, authorize: async (_owner, request) => {
    assert.equal(request.operation, "users.posts"); assert.equal(request.input.userId, profile.data.id);
    throw new ConnectorError("connector_permission_denied", "Denied", { statusCode: 403 });
  } });
  const count = requests.length, resolutions = state.resolutions;
  await assert.rejects(denied.invoke({ ...input, operation: "users.posts", input: { userId: profile.data.id } }), { code: "connector_permission_denied" });
  assert.equal(requests.length, count); assert.equal(state.resolutions, resolutions);
});

test("X cancellation and timeout do not replay reads or discard a valid connection", async (t) => {
  const { service, options, state, requests } = await fixture(t);
  await service.connectApiKey(verification); state.wait = true;
  const controller = new AbortController();
  const operation = { ...input, operation: "users.lookup", input: { username: "example" } };
  const pending = service.invoke({ ...operation, signal: controller.signal });
  setTimeout(() => controller.abort(), 15);
  await assert.rejects(pending, { code: "connector_cancelled" });
  const timeoutService = createConnectionService({ ...options, providers: [{ ...xTwitterProvider, requestTimeoutMs: 20 }] });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(timeoutService.invoke(operation), { code: "connector_provider_timeout" }); }
  finally { clearTimeout(keepAlive); }
  assert.equal(requests.length, 3); assert.equal((await service.status(input)).status, "connected");
  state.wait = false; assert.deepEqual(await service.invoke(operation), profile);
});

test("X guide configuration uses the same CLI validator as the editor", async () => {
  const guide = await readFile(new URL("../docs/x-twitter.md", import.meta.url), "utf8");
  const configuration = parseIntegrationConfiguration(guide.match(/```json\n([\s\S]*?)\n```/u)[1], { providers: [xTwitterProvider] });
  assert.equal(configuration.integrations.social.provider, "x-twitter");
  assert.equal(configuration.integrations.social.authentication.secretRef, "env:X_APP_BEARER_TOKEN");
  assert.deepEqual(configuration.registrations, {});
});


test("X recent search preserves queries, pagination and expanded public display data", async (t) => {
  const { service, state, requests } = await fixture(t);
  await service.connectApiKey(verification);
  const result = { ...page, includes: { users: [profile.data], media: [{ media_key: "3_123", type: "photo", url: "https://pbs.twimg.com/example.jpg" }] } };
  state.response = result;
  const call = { ...input, operation: "posts.searchRecent" };
  const query = '("pet grooming" OR #dogs) lang:en -is:retweet';
  assert.deepEqual(await service.invoke({ ...call, input: { query } }), result);
  const request = requests.at(-1);
  assert.equal(request.url.origin, "https://api.x.com");
  assert.equal(request.url.pathname, "/2/tweets/search/recent");
  assert.equal(request.url.searchParams.get("query"), query);
  assert.equal(request.url.searchParams.get("expansions"), "author_id,attachments.media_keys");
  assert.equal(request.url.searchParams.get("max_results"), "10");
  assert.equal(request.headers.get("authorization"), `Bearer ${state.key}`);
  await service.invoke({ ...call, input: { query, maxResults: 100, nextToken: "opaque+/=cursor" } });
  assert.equal(requests.at(-1).url.searchParams.get("next_token"), "opaque+/=cursor");
  const count = requests.length;
  for (const values of [{}, { query: " " }, { query: "x".repeat(513) }, { query: "a\nb" },
    { query, maxResults: 9 }, { query, maxResults: 101 }, { query, nextToken: "" },
    { query, url: "https://other.test" }]) {
    await assert.rejects(service.invoke({ ...call, input: values }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, count);
  state.response = { meta: { result_count: 0 } };
  assert.deepEqual(await service.invoke({ ...call, input: { query } }), state.response);
  state.response = { ...result, errors: [{ detail: state.key }] };
  await assert.rejects(service.invoke({ ...call, input: { query } }), { code: "connector_response_incomplete" });
  for (const [status, code] of [[402, "connector_billing_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"]]) {
    state.status = status;
    const before = requests.length;
    await assert.rejects(service.invoke({ ...call, input: { query } }), { code });
    assert.equal(requests.length, before + 1);
  }
});
