import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { validateIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { linkedinProvider as provider } from "../src/server/linkedin.js";

const context = { applicationId: "linkedin-app", subjectId: "member-one" };
const input = { context, integrationId: "linkedin" };
const callback = "https://app.example.test/connections/linkedin/callback";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "linkedin-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" });
  const configuration = { schemaVersion: 1, integrations: { linkedin: { provider: "linkedin", accountMode: "per-user",
    scopes: ["openid", "profile", "email"], authentication: { method: "oauth2", registrationRef: "linkedin" } } },
  registrations: { linkedin: { source: "own", clientId: "fixture-client", clientSecretRef: "env:LINKEDIN_SECRET", callbackUrlRef: "env:LINKEDIN_CALLBACK" } } };
  const state = { time: Date.now(), calls: [], grants: 0, response: { sub: "member-1", name: "Fixture Member" },
    scope: "openid profile email", status: 200, tokenStatus: 200, refresh: false, tokenOverrides: {}, deny: false, stall: false };
  const options = { configuration, providers: [provider], store: createFileConnectionStore({ directory, protection }), now: () => state.time,
    authorize: async (owner) => { if (state.deny) throw new Error("Host denied"); return owner; },
    resolveReference: async (ref) => ref === "env:LINKEDIN_CALLBACK" ? callback : "fixture-client-secret",
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)); const headers = new Headers(init.headers);
      state.calls.push({ url, init, headers });
      if (state.stall) return new Promise((resolve, reject) => {
        init.signal.throwIfAborted(); init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
      if (url.href === "https://www.linkedin.com/oauth/v2/accessToken") {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), "fixture-client");
        assert.equal(body.get("client_secret"), "fixture-client-secret");
        assert.equal(headers.has("authorization"), false);
        if (state.tokenStatus !== 200) return Response.json(state.tokenOverrides, { status: state.tokenStatus });
        if (body.get("grant_type") === "refresh_token") assert.equal(body.get("refresh_token"), `fixture-refresh-${state.grants}`);
        state.grants += 1;
        return Response.json({ access_token: `fixture-access-${state.grants}`, expires_in: 120,
          ...(state.refresh ? { refresh_token: `fixture-refresh-${state.grants}` } : {}),
          ...(state.scope === undefined ? {} : { scope: state.scope }), ...state.tokenOverrides });
      }
      if (url.href === "https://api.linkedin.com/v2/ugcPosts") {
        assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
        assert.equal(headers.get("authorization"), `Bearer fixture-access-${state.grants}`);
        assert.equal(headers.get("x-restli-protocol-version"), "2.0.0");
        return new Response(null, { status: state.publishStatus || 201, headers: { "x-restli-id": state.postId ?? "urn:li:share:123" } });
      }
      assert.equal(url.href, "https://api.linkedin.com/v2/userinfo");
      assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
      assert.equal(headers.get("authorization"), `Bearer fixture-access-${state.grants}`);
      assert.equal(String(init.body).includes("fixture-client-secret"), false);
      return Response.json(state.response, { status: state.status });
    }
  };
  const service = createConnectionService(options);
  async function start() {
    const { authorizationUrl } = await service.beginAuthorization(input);
    const url = new URL(authorizationUrl); const redirect = new URL(callback);
    redirect.searchParams.set("code", "fixture-code"); redirect.searchParams.set("state", url.searchParams.get("state"));
    return { url, callbackUrl: redirect.href };
  }
  return { service, options, configuration, directory, protection, state, start };
}

test("LinkedIn configuration requires both identity scopes and confidential registration across account modes", async (t) => {
  const { configuration } = await fixture(t);
  for (const accountMode of ["shared", "per-user", "assistant"]) {
    const config = structuredClone(configuration); config.integrations.linkedin.accountMode = accountMode;
    assert.equal(validateIntegrationConfiguration(config, { providers: [provider] }).integrations.linkedin.accountMode, accountMode);
  }
  for (const scopes of [["profile"], ["openid"], ["email"], ["openid", "profile", "admin"], ["openid", "profile", "profile"]]) {
    const config = structuredClone(configuration); config.integrations.linkedin.scopes = scopes;
    assert.throws(() => validateIntegrationConfiguration(config, { providers: [provider] }), { code: "integration_configuration_invalid" });
  }
  for (const update of [{ clientSecretRef: "raw-secret" }, { tokenEndpointAuthMethod: "none" }, { grantType: "client_credentials" }]) {
    const config = structuredClone(configuration); Object.assign(config.registrations.linkedin, update);
    assert.throws(() => validateIntegrationConfiguration(config, { providers: [provider] }), { code: "integration_configuration_invalid" });
  }
});

test("LinkedIn uses confidential Web OAuth, validates userinfo and persists only encrypted access credentials", async (t) => {
  const { service, options, directory, protection, state, start } = await fixture(t);
  state.tokenOverrides = { id_token: "unused-identity-token" };
  const { url, callbackUrl } = await start();
  assert.equal(url.origin + url.pathname, "https://www.linkedin.com/oauth/v2/authorization");
  assert.equal(url.searchParams.get("redirect_uri"), callback);
  assert.equal(url.searchParams.get("scope"), "openid profile email");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.has("client_secret"), false);
  const connected = await service.completeAuthorization({ ...input, callbackUrl });
  assert.equal(connected.status, "connected");
  const body = new URLSearchParams(state.calls[0].init.body);
  assert.equal(body.get("grant_type"), "authorization_code"); assert.equal(body.get("redirect_uri"), callback); assert.ok(body.get("code_verifier"));
  assert.deepEqual(connected.grantedScopes, ["openid", "profile", "email"]);
  assert.equal(JSON.stringify(connected).includes("fixture-access"), false);
  for (const name of await readdir(directory)) {
    const text = await readFile(path.join(directory, name), "utf8");
    for (const secret of ["fixture-client-secret", "fixture-access-1", "unused-identity-token"]) assert.equal(text.includes(secret), false);
  }
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.invoke({ ...input, operation: "profile.read" }), state.response);
  state.response = { sub: "member-1", email: "member@example.test", email_verified: false };
  assert.deepEqual(await restarted.invoke({ ...input, operation: "profile.read" }), state.response);
  for (const owner of [{ ...context, applicationId: "another-app" }, { ...context, subjectId: "another-user" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "profile.read" }), { code: "connector_reconnect_required" });
  }
  await restarted.disconnect(input); assert.equal((await service.status(input)).status, "disconnected");
});

test("LinkedIn cancels pending consent, rejects replay and preserves a grant when replacement consent is declined", async (t) => {
  const { service, state, start } = await fixture(t);
  const cancelled = await start();
  await service.cancelAuthorization({ ...input, state: cancelled.url.searchParams.get("state") });
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: cancelled.callbackUrl }), { code: "connector_attempt_invalid" });
  const first = await start(); const connected = await service.completeAuthorization({ ...input, callbackUrl: first.callbackUrl });
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: first.callbackUrl }), { code: "connector_attempt_invalid" });
  for (const error of ["user_cancelled_login", "user_cancelled_authorize", "access_denied"]) {
    const attempt = await start(); const url = new URL(attempt.callbackUrl); url.searchParams.delete("code"); url.searchParams.set("error", error);
    url.searchParams.set("error_description", "private-provider-detail");
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: url.href }), { code: "connector_consent_denied" });
    assert.deepEqual(await service.status(input), { ...connected, callbackUrl: callback });
  }
  assert.equal(state.grants, 1);
});

test("LinkedIn does not invent refresh access when ordinary access expires", async (t) => {
  const { service, state, start } = await fixture(t);
  state.scope = undefined;
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  state.time += 121_000;
  await assert.rejects(service.invoke({ ...input, operation: "profile.read" }), { code: "connector_reconnect_required" });
  assert.equal(state.grants, 1); assert.equal((await service.status(input)).status, "reconnect-required");
});

test("LinkedIn refreshes approved grants once under contention and does not expand permissions", async (t) => {
  const { service, state, start } = await fixture(t); state.refresh = true; state.scope = "openid profile";
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  state.time += 121_000; state.scope = "openid profile email w_member_social";
  const results = await Promise.all([service.invoke({ ...input, operation: "profile.read" }), service.invoke({ ...input, operation: "profile.read" })]);
  assert.deepEqual(results, [state.response, state.response]); assert.equal(state.grants, 2);
  assert.deepEqual((await service.status(input)).grantedScopes, ["openid", "profile"]);
  state.time += 121_000; state.tokenStatus = 400; state.tokenOverrides = { error: "invalid_request", error_description: "private-refresh-detail" };
  await assert.rejects(service.invoke({ ...input, operation: "profile.read" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("LinkedIn rejects malformed or insufficient token responses before saving", async (t) => {
  const { service, state, start } = await fixture(t);
  for (const update of [{ expires_in: 0 }, { expires_in: null }, { scope: ["openid", "profile"] }, { scope: "" }, { token_type: "mac" }, { token_type: null }, { access_token: "" }]) {
    state.tokenOverrides = update;
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl }));
    assert.equal((await service.status(input)).status, "disconnected");
  }
  for (const scope of ["openid", "profile", "email"]) {
    state.tokenOverrides = { scope };
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl }), { code: "connector_reconnect_required" });
  }
});

test("LinkedIn rejects invalid profiles, arbitrary input and unauthorized publishing without contacting other endpoints", async (t) => {
  const { service, state, start } = await fixture(t);
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  const count = state.calls.length;
  for (const values of [{ url: "https://attacker.invalid" }, { memberId: "other" }, { fields: "email" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "profile.read", input: values }), { code: "connector_input_invalid" });
  }
  await assert.rejects(service.invoke({ ...input, operation: "posts.create", input: { text: "Do not send", visibility: "PUBLIC" } }), { code: "connector_scope_missing" });
  assert.equal(state.calls.length, count);
  for (const response of [{}, { sub: "" }, { sub: 3 }, { sub: "one", email: null }, { sub: "one", email_verified: "true" }]) {
    state.response = response;
    await assert.rejects(service.invoke({ ...input, operation: "profile.read" }), { code: "connector_response_invalid" });
  }
});

test("LinkedIn sanitizes API failures and handles provider cancellation and timeout", async (t) => {
  const { service, options, state, start } = await fixture(t);
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status; state.response = { message: "private-provider-detail" };
    await assert.rejects(service.invoke({ ...input, operation: "profile.read" }), (error) => error.code === code && !error.message.includes("private-provider-detail"));
  }
  state.stall = true;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.invoke({ ...input, operation: "profile.read", signal: controller.signal }), { code: "connector_cancelled" });
  const timeoutService = createConnectionService({ ...options, providers: [{ ...provider, requestTimeoutMs: 20 }] });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(timeoutService.invoke({ ...input, operation: "profile.read" }), { code: "connector_provider_timeout" }); }
  finally { clearTimeout(keepAlive); }
  state.stall = false; state.status = 401;
  await assert.rejects(service.invoke({ ...input, operation: "profile.read" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("LinkedIn respects host policy, registration identity and unavailable managed assignments", async (t) => {
  const { service, options, configuration, state, start } = await fixture(t);
  await service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  const count = state.calls.length; state.deny = true;
  await assert.rejects(service.invoke({ ...input, operation: "profile.read" })); assert.equal(state.calls.length, count); state.deny = false;
  const changed = structuredClone(configuration); changed.registrations.linkedin.clientId = "other-client";
  await assert.rejects(createConnectionService({ ...options, configuration: changed }).invoke({ ...input, operation: "profile.read" }), { code: "connector_reconnect_required" });
  changed.registrations.linkedin = { source: "managed", serviceUrlRef: "env:GATEWAY", serviceCredentialRef: "env:GATEWAY_KEY", assignmentRef: "online" };
  assert.throws(() => createConnectionService({ ...options, configuration: changed }), { code: "integration_configuration_invalid" });
  assert.equal(state.calls.length, count);
});

test("LinkedIn's documented portable JSON validates unchanged", async () => {
  const guide = await readFile(new URL("../docs/linkedin.md", import.meta.url), "utf8");
  const config = JSON.parse(guide.match(/```json\n([\s\S]*?)\n```/u)[1]);
  assert.deepEqual(validateIntegrationConfiguration(config, { providers: [provider] }), config);
});

test("LinkedIn publishes text as the connected member and respects host policy without retries", async (t) => {
  const f = await fixture(t); f.configuration.integrations.linkedin.scopes.push("w_member_social");
  f.state.scope += " w_member_social";
  const service = createConnectionService(f.options);
  const auth = new URL((await service.beginAuthorization(input)).authorizationUrl);
  const returned = new URL(callback); returned.searchParams.set("code", "code"); returned.searchParams.set("state", auth.searchParams.get("state"));
  await service.completeAuthorization({ ...input, callbackUrl: returned.href });
  const call = values => service.invoke({ ...input, operation: "posts.create", input: values });
  const post = { text: "Approved announcement", visibility: "CONNECTIONS" };
  assert.deepEqual(await call(post), { id: "urn:li:share:123" });
  assert.deepEqual(JSON.parse(f.state.calls.at(-1).init.body), {
    author: "urn:li:person:member-1", lifecycleState: "PUBLISHED",
    specificContent: { "com.linkedin.ugc.ShareContent": { shareCommentary: { text: post.text }, shareMediaCategory: "NONE" } },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "CONNECTIONS" }
  });
  let count = f.state.calls.length;
  for (const bad of [{ ...post, author: "urn:li:person:foreign" }, { ...post, text: " " }, { ...post, visibility: "PRIVATE" }, { text: "missing audience" }])
    await assert.rejects(call(bad), { code: "connector_input_invalid" });
  f.state.deny = true; await assert.rejects(call(post)); f.state.deny = false;
  assert.equal(f.state.calls.length, count);
  f.state.response = { sub: "bad/person" }; await assert.rejects(call(post), { code: "connector_response_invalid" });
  assert.equal(f.state.calls.length, count + 1); f.state.response = { sub: "member-1" };
  for (const status of [403, 429, 500]) {
    f.state.publishStatus = status; count = f.state.calls.length;
    await assert.rejects(call(post)); assert.equal(f.state.calls.length, count + 2);
  }
  f.state.publishStatus = 201; f.state.postId = "";
  await assert.rejects(call(post), { code: "connector_response_invalid" });
});
