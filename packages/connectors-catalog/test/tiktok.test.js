import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { validateIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { tiktokProvider as provider } from "../src/server/tiktok.js";

const context = { applicationId: "tiktok-app", subjectId: "creator-one" };
const input = { context, integrationId: "tiktok" };
const callback = "https://app.example.test/connections/tiktok/callback";
const scopes = ["user.info.basic", "user.info.stats", "user.info.profile", "video.list"];
const profile = { data: { user: { open_id: "creator-1", display_name: "Fixture Creator", avatar_url: "https://image.example/avatar" } }, error: { code: "ok" } };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "tiktok-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" });
  const configuration = { schemaVersion: 1, integrations: { tiktok: { provider: "tiktok", accountMode: "per-user", scopes: [...scopes],
    authentication: { method: "oauth2", registrationRef: "tiktok" } } }, registrations: { tiktok: { source: "own", clientId: "fixture-key",
    clientSecretRef: "env:TIKTOK_SECRET", callbackUrlRef: "env:TIKTOK_CALLBACK" } } };
  const state = { time: Date.now(), calls: [], grants: 0, response: profile, scope: scopes.join(","),
    status: 200, tokenStatus: 200, tokenOverrides: {}, deny: false, stall: false };
  const options = { configuration, providers: [provider], store: createFileConnectionStore({ directory, protection }), now: () => state.time,
    authorize: async (owner) => { if (state.deny) throw new Error("Host denied"); return owner; },
    resolveReference: async (ref) => ref === "env:TIKTOK_CALLBACK" ? callback : "fixture-client-secret",
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)); const headers = new Headers(init.headers);
      state.calls.push({ url, init, headers });
      if (state.stall) return new Promise((resolve, reject) => {
        init.signal.throwIfAborted(); init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
      if (url.href === "https://open.tiktokapis.com/v2/oauth/token/") {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_key"), "fixture-key"); assert.equal(body.has("client_id"), false);
        assert.equal(body.get("client_secret"), "fixture-client-secret"); assert.equal(headers.has("authorization"), false);
        if (body.get("grant_type") === "refresh_token") assert.equal(body.get("refresh_token"), `fixture-refresh-${state.grants}`);
        if (state.tokenStatus !== 200) return Response.json(state.tokenOverrides, { status: state.tokenStatus });
        state.grants += 1;
        return Response.json({ access_token: `fixture-access-${state.grants}`, token_type: "Bearer", expires_in: 120,
          refresh_token: `fixture-refresh-${state.grants}`, refresh_expires_in: 3600, open_id: "creator-1", scope: state.scope, ...state.tokenOverrides });
      }
      assert.equal(url.origin, "https://open.tiktokapis.com"); assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
      assert.equal(headers.get("authorization"), `Bearer fixture-access-${state.grants}`);
      if (url.pathname.endsWith("video/list/")) { assert.equal(init.method, "POST"); assert.equal(headers.get("content-type"), "application/json"); }
      else { assert.equal(url.pathname, "/v2/user/info/"); assert.equal(init.method, "GET"); }
      return Response.json(state.response, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  async function start() {
    const { authorizationUrl } = await service.beginAuthorization(input);
    const url = new URL(authorizationUrl); const redirect = new URL(callback);
    redirect.searchParams.set("code", "fixture-code"); redirect.searchParams.set("state", url.searchParams.get("state"));
    redirect.searchParams.set("scopes", state.scope);
    return { url, callbackUrl: redirect.href };
  }
  return { service, options, configuration, directory, protection, state, start };
}

test("TikTok configuration requires basic access, a confidential registration and a valid HTTPS callback", async (t) => {
  const { configuration, options, state } = await fixture(t);
  for (const accountMode of ["shared", "per-user", "assistant"]) {
    const config = structuredClone(configuration); config.integrations.tiktok.accountMode = accountMode;
    assert.equal(validateIntegrationConfiguration(config, { providers: [provider] }).integrations.tiktok.accountMode, accountMode);
  }
  for (const invalid of [[], ["video.list"], ["user.info.basic", "admin"], ["user.info.basic", "user.info.basic"]]) {
    const config = structuredClone(configuration); config.integrations.tiktok.scopes = invalid;
    assert.throws(() => validateIntegrationConfiguration(config, { providers: [provider] }), { code: "integration_configuration_invalid" });
  }
  for (const update of [{ clientSecretRef: "raw-secret" }, { tokenEndpointAuthMethod: "none" }, { grantType: "client_credentials" }]) {
    const config = structuredClone(configuration); Object.assign(config.registrations.tiktok, update);
    assert.throws(() => validateIntegrationConfiguration(config, { providers: [provider] }), { code: "integration_configuration_invalid" });
  }
  for (const value of ["http://127.0.0.1:8080/callback", `${callback}?tenant=1`, `${callback}#done`, `https://app.example/${"x".repeat(500)}`]) {
    const service = createConnectionService({ ...options, resolveReference: async (ref) => ref === "env:TIKTOK_CALLBACK" ? value : "fixture-client-secret" });
    await assert.rejects(service.beginAuthorization(input), { code: "connector_callback_invalid" });
  }
  assert.equal(state.calls.length, 0);
});

test("TikTok sends client_key and comma scopes, verifies the account and persists encrypted credentials", async (t) => {
  const { service, options, directory, protection, state, start } = await fixture(t);
  const { url, callbackUrl } = await start();
  assert.equal(url.origin + url.pathname, "https://www.tiktok.com/v2/auth/authorize/");
  assert.equal(url.searchParams.get("redirect_uri"), callback); assert.equal(url.searchParams.get("scope"), scopes.join(","));
  assert.equal(url.searchParams.get("client_key"), "fixture-key"); assert.equal(url.searchParams.has("client_id"), false);
  assert.equal(url.searchParams.has("client_secret"), false); assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const connected = await service.completeAuthorization({ ...input, callbackUrl });
  assert.equal(connected.status, "connected"); assert.deepEqual(connected.grantedScopes, scopes);
  const body = new URLSearchParams(state.calls[0].init.body);
  assert.equal(body.get("grant_type"), "authorization_code"); assert.equal(body.get("redirect_uri"), callback); assert.ok(body.get("code_verifier"));
  assert.equal(state.calls[1].url.searchParams.get("fields"), "open_id,display_name,avatar_url");
  assert.equal(JSON.stringify(connected).includes("fixture-access"), false);
  for (const name of await readdir(directory)) {
    const text = await readFile(path.join(directory, name), "utf8");
    for (const secret of ["fixture-client-secret", "fixture-access-1", "fixture-refresh-1"]) assert.equal(text.includes(secret), false);
  }
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.invoke({ ...input, operation: "profile.read" }), profile);
  for (const owner of [{ ...context, applicationId: "another-app" }, { ...context, subjectId: "another-user" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "profile.read" }), { code: "connector_reconnect_required" });
  }
  await restarted.disconnect(input); assert.equal((await service.status(input)).status, "disconnected");
});

test("TikTok cancellation and replay never replace an existing verified grant", async (t) => {
  const { service, state, start } = await fixture(t);
  const cancelled = await start(); await service.cancelAuthorization({ ...input, state: cancelled.url.searchParams.get("state") });
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: cancelled.callbackUrl }), { code: "connector_attempt_invalid" });
  const first = await start();
  await assert.rejects(service.completeAuthorization({ ...input, context: { ...context, subjectId: "other" }, callbackUrl: first.callbackUrl }), { code: "connector_attempt_invalid" });
  await service.completeAuthorization({ ...input, callbackUrl: first.callbackUrl });
  const connected = await service.status(input);
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: first.callbackUrl }), { code: "connector_attempt_invalid" });
  const declined = new URL((await start()).callbackUrl); declined.searchParams.delete("code"); declined.searchParams.set("error", "access_denied");
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: declined.href }), { code: "connector_consent_denied" });
  assert.deepEqual(await service.status(input), connected); assert.equal(state.grants, 1);
});

test("TikTok reduced grants block optional operations and refresh cannot expand access", async (t) => {
  const { service, state, start } = await fixture(t); state.scope = "user.info.basic";
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  const before = state.calls.length;
  for (const operation of ["profile.extended", "profile.stats", "videos.list"]) {
    await assert.rejects(service.invoke({ ...input, operation }), { code: "connector_scope_missing" });
  }
  assert.equal(state.calls.length, before);
  state.time += 121_000; state.scope = scopes.join(",");
  assert.deepEqual(await Promise.all([service.invoke({ ...input, operation: "profile.read" }), service.invoke({ ...input, operation: "profile.read" })]), [profile, profile]);
  assert.equal(state.grants, 2); assert.deepEqual((await service.status(input)).grantedScopes, ["user.info.basic"]);
  state.time += 121_000; await service.invoke({ ...input, operation: "profile.read" }); assert.equal(state.grants, 3);
  state.time += 121_000; state.tokenStatus = 400; state.tokenOverrides = { error: "invalid_grant", error_description: "private-refresh-detail" };
  await assert.rejects(service.invoke({ ...input, operation: "profile.read" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("TikTok refresh can shrink permissions and initial grants cannot exceed configured permissions", async (t) => {
  const { service, state, start, configuration, options } = await fixture(t);
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  state.time += 121_000; state.scope = "user.info.basic";
  await service.invoke({ ...input, operation: "profile.read" });
  await assert.rejects(service.invoke({ ...input, operation: "videos.list" }), { code: "connector_scope_missing" });
  await service.disconnect(input);
  const config = structuredClone(configuration); config.integrations.tiktok.scopes = ["user.info.basic"];
  const reduced = createConnectionService({ ...options, configuration: config });
  state.scope = scopes.join(",");
  const begin = new URL((await reduced.beginAuthorization(input)).authorizationUrl);
  const result = await reduced.completeAuthorization({ ...input, callbackUrl: `${callback}?state=${begin.searchParams.get("state")}&code=code` });
  assert.deepEqual(result.grantedScopes, ["user.info.basic"]);
});

test("TikTok refuses malformed token grants and failed verification without storing credentials", async (t) => {
  const { service, state, start } = await fixture(t);
  for (const update of [{ expires_in: 0 }, { refresh_expires_in: null }, { open_id: 3 }, { refresh_token: "" }, { scope: "" },
    { scope: "user.info.basic video.list" }, { scope: "user.info.basic,user.info.basic" }, { scope: "video.list" }, { token_type: "mac" }, { access_token: "" }, { error: "invalid_grant" }]) {
    state.tokenOverrides = update;
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl }));
    assert.equal((await service.status(input)).status, "disconnected");
  }
  state.tokenOverrides = {}; state.response = { data: { user: {} }, error: { code: "ok" } };
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl }), { code: "connector_response_invalid" });
  assert.equal((await service.status(input)).status, "disconnected");
});

test("TikTok reads extended profile, statistics and explicit video pages with string IDs", async (t) => {
  const { service, state, start } = await fixture(t);
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  state.response = { data: { user: { username: "creator", bio_description: "", profile_deep_link: "https://www.tiktok.com/@creator", is_verified: false } }, error: { code: "ok" } };
  assert.deepEqual(await service.invoke({ ...input, operation: "profile.extended" }), state.response);
  assert.equal(state.calls.at(-1).url.searchParams.get("fields"), "username,bio_description,profile_deep_link,is_verified");
  state.response = { data: { user: { follower_count: 0, following_count: 1, likes_count: 2, video_count: 3 } }, error: { code: "ok" } };
  assert.deepEqual(await service.invoke({ ...input, operation: "profile.stats" }), state.response);
  state.response = { data: { videos: [{ id: "9123456789012345678", title: "Fixture", cover_image_url: "https://image.example/cover" }], cursor: 1650000000000, has_more: true }, error: { code: "ok" } };
  assert.deepEqual(await service.invoke({ ...input, operation: "videos.list", input: { max_count: 1 } }), state.response);
  assert.deepEqual(JSON.parse(state.calls.at(-1).init.body), { max_count: 1 });
  state.response = { data: { videos: [], cursor: 1640000000000, has_more: false }, error: { code: "ok" } };
  assert.deepEqual(await service.invoke({ ...input, operation: "videos.list", input: { cursor: 1650000000000 } }), state.response);
  assert.deepEqual(JSON.parse(state.calls.at(-1).init.body), { max_count: 10, cursor: 1650000000000 });
  assert.equal(state.calls.length, 6);
});

test("TikTok rejects arbitrary inputs, unsupported writes and malformed response fields", async (t) => {
  const { service, state, start } = await fixture(t);
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  const before = state.calls.length;
  for (const values of [{ max_count: 21 }, { max_count: 1.5 }, { cursor: -1 }, { cursor: Number.MAX_SAFE_INTEGER + 1 }, { url: "https://attacker.invalid" }, { user_id: "other" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "videos.list", input: values }), { code: "connector_input_invalid" });
  }
  await assert.rejects(service.invoke({ ...input, operation: "videos.publish" }), { code: "connector_operation_unknown" });
  assert.equal(state.calls.length, before);
  for (const [operation, response] of [["profile.read", {}], ["profile.read", { data: { user: { ...profile.data.user, open_id: 9 } }, error: { code: "ok" } }],
    ["profile.extended", profile], ["profile.stats", { data: { user: { follower_count: -1, following_count: 1, likes_count: 2, video_count: 3 } }, error: { code: "ok" } }],
    ["videos.list", { data: { videos: [{ id: 42, title: "Fixture", cover_image_url: "https://image.example/cover" }], cursor: 0, has_more: false }, error: { code: "ok" } }],
    ["videos.list", { data: { videos: [], cursor: 0, has_more: "false" }, error: { code: "ok" } }]]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation }), { code: "connector_response_invalid" });
  }
});

test("TikTok distinguishes missing scopes from expired access and sanitizes provider errors", async (t) => {
  const { service, options, state, start } = await fixture(t);
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  for (const [status, providerCode, code] of [[401, "scope_not_authorized", "connector_scope_missing"], [400, "scope_permission_missed", "connector_scope_missing"],
    [429, "rate_limit_exceeded", "connector_rate_limited"], [500, "internal_error", "connector_provider_failed"], [200, "invalid_params", "connector_provider_failed"]]) {
    for (const nested of [false, true]) {
      const error = { code: providerCode, message: "private-provider-detail", log_id: "private-trace" };
      state.status = status; state.response = nested ? { error } : error;
      await assert.rejects(service.invoke({ ...input, operation: "profile.read" }), (failure) => failure.code === code && !failure.message.includes("private"));
      assert.equal((await service.status(input)).status, "connected");
    }
  }
  state.stall = true;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.invoke({ ...input, operation: "profile.read", signal: controller.signal }), { code: "connector_cancelled" });
  const timeoutService = createConnectionService({ ...options, providers: [{ ...provider, requestTimeoutMs: 20 }] });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(timeoutService.invoke({ ...input, operation: "profile.read" }), { code: "connector_provider_timeout" }); }
  finally { clearTimeout(keepAlive); }
  state.stall = false; state.status = 401; state.response = { error: { code: "access_token_invalid" } };
  await assert.rejects(service.invoke({ ...input, operation: "profile.read" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("TikTok enforces host policy, registration ownership and unavailable managed assignments", async (t) => {
  const { service, options, configuration, state, start } = await fixture(t);
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  const before = state.calls.length; state.deny = true;
  await assert.rejects(service.invoke({ ...input, operation: "profile.read" })); assert.equal(state.calls.length, before); state.deny = false;
  const changed = structuredClone(configuration); changed.registrations.tiktok.clientId = "other-key";
  await assert.rejects(createConnectionService({ ...options, configuration: changed }).invoke({ ...input, operation: "profile.read" }), { code: "connector_reconnect_required" });
  changed.registrations.tiktok = { source: "managed", serviceUrlRef: "env:GATEWAY", serviceCredentialRef: "env:GATEWAY_KEY", assignmentRef: "online" };
  assert.throws(() => createConnectionService({ ...options, configuration: changed }), { code: "integration_configuration_invalid" });
  assert.equal(state.calls.length, before);
});

test("TikTok's documented portable JSON validates unchanged", async () => {
  const guide = await readFile(new URL("../docs/tiktok.md", import.meta.url), "utf8");
  const config = JSON.parse(guide.match(/```json\n([\s\S]*?)\n```/u)[1]);
  assert.deepEqual(validateIntegrationConfiguration(config, { providers: [provider] }), config);
});
