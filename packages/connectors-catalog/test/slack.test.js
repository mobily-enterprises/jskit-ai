import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { slackProvider, verifySlackRequest } from "../src/server/slack.js";

const callback = "https://app.example.test/slack/callback";
const context = { applicationId: "app-one", subjectId: "user-one" };
const input = { context, integrationId: "slack" };
const scopes = ["channels:read", "groups:read", "im:read", "mpim:read"];
const page = { ok: true, channels: [{ id: "C123", name: "general" }], response_metadata: { next_cursor: "next +&/=" } };

async function fixture(t, actor = "user", granted = scopes) {
  const directory = await mkdtemp(path.join(tmpdir(), "slack-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const state = { time: Date.now(), tokenCount: 0, tokenScope: granted.join(","), tokenStatus: 200, apiStatus: 200, page, rotation: true };
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current" });
  const token = (type) => ({ token_type: type, scope: state.tokenScope, access_token: `secret-${type}-access-${state.tokenCount}`,
    ...(state.rotation ? { refresh_token: `secret-${type}-refresh-${state.tokenCount}+&`, expires_in: 60 } : {}) });
  const options = {
    configuration: { schemaVersion: 1, integrations: { slack: { provider: "slack", accountMode: "per-user", settings: { actor }, scopes: granted,
      authentication: { method: "oauth2", registrationRef: "slack" } } }, registrations: {
      slack: { source: "own", clientId: "111.222", clientSecretRef: "env:SLACK_SECRET", callbackUrlRef: "env:SLACK_CALLBACK" }
    } }, providers: [slackProvider], authorize: async (owner) => owner, now: () => state.time,
    resolveReference: async (ref) => ref === "env:SLACK_CALLBACK" ? callback : "secret-client",
    store: createFileConnectionStore({ directory, protection }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address));
      requests.push({ url, init });
      assert.equal(url.origin, "https://slack.com");
      if (state.interruptPath === url.pathname) {
        state.controller.abort(new DOMException("secret-client", state.interruptName || "AbortError"));
        throw init.signal.reason;
      }
      if (url.pathname === "/api/oauth.v2.access") {
        assert.equal(init.method, "POST");
        assert.equal(init.redirect, "manual");
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), "111.222");
        assert.equal(body.get("client_secret"), "secret-client");
        if (body.get("grant_type") === "refresh_token") assert.equal(body.get("refresh_token"), `secret-${actor}-refresh-${state.tokenCount}+&`);
        state.tokenCount++;
        if (state.tokenText !== undefined) return new Response(state.tokenText, { status: state.tokenStatus });
        const reply = body.get("grant_type") === "refresh_token" ? { ok: true, ...token(actor) }
          : { ok: true, ...token("bot"), authed_user: { id: "U123", ...token("user") } };
        return Response.json(state.tokenResponse === undefined ? reply : state.tokenResponse, { status: state.tokenStatus });
      }
      if (state.apiReply) return state.apiReply(url, init);
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "error");
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer secret-${actor}-access-${state.tokenCount}`);
      assert(["/api/conversations.list", "/api/auth.test"].includes(url.pathname));
      return Response.json(url.pathname === "/api/auth.test" ? { ok: true, team_id: "T123", user_id: "U123" } : state.page, { status: state.apiStatus });
    }
  };
  const service = createConnectionService(options);
  async function start() {
    const { authorizationUrl } = await service.beginAuthorization(input);
    const url = new URL(authorizationUrl);
    const redirect = new URL(callback);
    redirect.searchParams.set("code", "fixture-code");
    redirect.searchParams.set("state", url.searchParams.get("state"));
    return { url, callbackUrl: redirect.href };
  }
  const connect = async () => service.completeAuthorization({ ...input, callbackUrl: (await start()).callbackUrl });
  return { service, options, requests, state, start, connect, directory, protection };
}

for (const actor of ["user", "bot"]) {
  test(`Slack ${actor}: consent selects only its identity and persists encrypted grants across restart`, async (t) => {
    const { service, options, start, requests, directory, protection } = await fixture(t, actor);
    const { url, callbackUrl } = await start();
    assert.equal(url.origin + url.pathname, "https://slack.com/oauth/v2/authorize");
    assert.equal(url.searchParams.get(actor === "user" ? "user_scope" : "scope"), scopes.join(","));
    assert.equal(url.searchParams.has(actor === "user" ? "scope" : "user_scope"), false);
    assert.equal(url.searchParams.get("redirect_uri"), callback);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.has("client_secret"), false);
    const connected = await service.completeAuthorization({ ...input, callbackUrl });
    assert.equal(connected.status, "connected");
    assert.deepEqual(connected.grantedScopes, scopes);
    const body = new URLSearchParams(requests[0].init.body);
    assert.equal(body.get("redirect_uri"), callback);
    assert.equal(body.get("code"), "fixture-code");
    assert(body.get("code_verifier"));
    assert.equal(requests[1].url.searchParams.get("types"), "public_channel");
    for (const filename of await readdir(directory)) assert(!(await readFile(path.join(directory, filename), "utf8")).includes("secret-"));
    const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
    assert.deepEqual(await restarted.status(input), { ...connected, callbackUrl: callback });
    for (const [operation, type] of [["channels.list", "public_channel"], ["groups.list", "private_channel"], ["directMessages.list", "im"], ["groupMessages.list", "mpim"]]) {
      assert.deepEqual(await restarted.invoke({ ...input, operation, input: { limit: 5, cursor: "next +&/=", exclude_archived: true } }), page);
      assert.equal(requests.at(-1).url.searchParams.get("types"), type);
      assert.equal(requests.at(-1).url.searchParams.get("cursor"), "next +&/=");
      assert.equal(requests.at(-1).url.searchParams.get("exclude_archived"), "true");
    }
    assert.deepEqual(await restarted.invoke({ ...input, operation: "auth.test" }), { ok: true, team_id: "T123", user_id: "U123" });
    for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-user" }]) {
      await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "channels.list" }), { code: "connector_reconnect_required" });
    }
    await restarted.disconnect(input);
    assert.equal((await service.status(input)).status, "disconnected");
  });

  test(`Slack ${actor}: serializes rotating refresh tokens across services and retains its identity`, async (t) => {
    const { service, options, state, connect, requests } = await fixture(t, actor);
    await connect();
    state.time += 40_000;
    const restarted = createConnectionService(options);
    await Promise.all([service.invoke({ ...input, operation: "channels.list" }), restarted.invoke({ ...input, operation: "groups.list" })]);
    assert.equal(state.tokenCount, 2);
    state.time += 40_000;
    await restarted.invoke({ ...input, operation: "channels.list" });
    assert.equal(state.tokenCount, 3);
    assert(requests.filter(({ url }) => url.pathname === "/api/oauth.v2.access").every(({ init }) => !String(init.body).includes("secret-bot-refresh") || actor === "bot"));
  });

  test(`Slack ${actor}: non-expiring grants work without synthetic refresh tokens`, async (t) => {
    const { service, state, connect } = await fixture(t, actor);
    state.rotation = false;
    await connect();
    state.time += 24 * 60 * 60 * 1000;
    await service.invoke({ ...input, operation: "channels.list" });
    assert.equal(state.tokenCount, 1);
  });

  test(`Slack ${actor}: wrong-identity and malformed token replies cannot connect or borrow the other token`, async (t) => {
    const { service, state, connect } = await fixture(t, actor);
    for (const reply of [null, { ok: true }, { ok: true, token_type: "bot", access_token: "secret-bot", scope: "channels:read", authed_user: { token_type: "bot" } },
      { ok: true, token_type: "user", scope: "channels:read", access_token: "secret-user", authed_user: { token_type: "user", scope: [] } }]) {
      if (actor === "bot" && reply?.token_type === "bot") continue;
      state.tokenResponse = reply;
      await assert.rejects(connect(), { code: "connector_response_invalid" });
      assert.equal((await service.status(input)).status, "disconnected");
    }
    state.tokenResponse = undefined;
    state.tokenScope = "groups:read";
    await assert.rejects(connect(), { code: "connector_scope_missing" });
    assert.equal((await service.status(input)).status, "disconnected");
  });
}

test("Slack configuration keeps 57 permission choices but rejects permissions belonging to the other actor", async (t) => {
  const { options, requests } = await fixture(t);
  assert.equal(slackProvider.scopes.length, 57);
  assert.equal(slackProvider.scopesForSettings({ actor: "user" }).length, 52);
  assert.equal(slackProvider.scopesForSettings({ actor: "bot" }).length, 49);
  const parse = (config) => parseIntegrationConfiguration(JSON.stringify(config), { providers: [slackProvider] });
  for (const actor of ["user", "bot"]) {
    const config = structuredClone(options.configuration);
    config.integrations.slack.settings.actor = actor;
    config.integrations.slack.scopes = slackProvider.scopesForSettings({ actor }).map(({ value }) => value);
    assert.deepEqual(parse(config).integrations.slack.scopes, config.integrations.slack.scopes);
    config.integrations.slack.scopes = [actor === "user" ? "channels:join" : "users.profile:write"];
    assert.throws(() => parse(config), (error) => Boolean(error.fieldErrors["integrations.slack.scopes"]));
  }
  const invalid = structuredClone(options.configuration);
  invalid.integrations.slack.settings.actor = "admin";
  assert.throws(() => parse(invalid));
  delete invalid.integrations.slack.settings;
  assert.equal(parse(invalid).integrations.slack.settings.actor, "user");
  assert.equal(requests.length, 0);
});

test("Slack changing actor invalidates pending attempts and connections, and cancellation preserves existing access", async (t) => {
  const { service, options, start, connect, requests } = await fixture(t);
  await connect();
  const pending = await start();
  await service.cancelAuthorization({ ...input, state: pending.url.searchParams.get("state") });
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: pending.callbackUrl }), { code: "connector_attempt_invalid" });
  assert.equal((await service.status(input)).status, "connected");
  const next = await start();
  const configuration = structuredClone(options.configuration);
  configuration.integrations.slack.settings.actor = "bot";
  const changed = createConnectionService({ ...options, configuration });
  const before = requests.length;
  await assert.rejects(changed.completeAuthorization({ ...input, callbackUrl: next.callbackUrl }), { code: "connector_attempt_invalid" });
  await assert.rejects(changed.invoke({ ...input, operation: "channels.list" }), { code: "connector_reconnect_required" });
  assert.equal((await changed.status(input)).status, "reconnect-required");
  assert.equal(requests.length, before);
});

test("Slack applies operation permissions and input bounds before network access and preserves empty cursor pages", async (t) => {
  const { service, state, connect, requests } = await fixture(t);
  state.tokenScope = "channels:read";
  await connect();
  const before = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "groups.list" }), { code: "connector_scope_missing" });
  for (const value of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { types: "private_channel" }, { team_id: "TOTHER" }, { cursor: "" }, { url: "https://attacker.example" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "channels.list", input: value }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, before);
  state.page = { ok: true, channels: [], response_metadata: { next_cursor: "more" } };
  assert.deepEqual(await service.invoke({ ...input, operation: "channels.list" }), state.page);
  for (const reply of [{ ok: true, channels: null }, { ok: true, channels: [null] }, { ok: true, channels: [], response_metadata: [] }, { ok: true, channels: [], response_metadata: { next_cursor: 3 } }]) {
    state.page = reply;
    await assert.rejects(service.invoke({ ...input, operation: "channels.list" }), { code: "connector_response_invalid" });
  }
});

test("Slack HTTP-200 failures and refresh failures stay errors without exposing provider fields", async (t) => {
  const { service, state, connect } = await fixture(t);
  await connect();
  for (const [error, code] of [["missing_scope", "connector_permission_denied"], ["ratelimited", "connector_rate_limited"], ["unknown_error", "connector_provider_failed"]]) {
    state.page = { ok: false, error, secret: "secret-client" };
    await assert.rejects(service.invoke({ ...input, operation: "channels.list" }), (failure) => {
      assert.equal(failure.code, code);
      assert(!JSON.stringify(failure).includes("secret-client"));
      return true;
    });
  }
  state.page = page;
  state.time += 40_000;
  state.tokenResponse = { ok: false, error: "invalid_refresh_token", detail: "secret-client" };
  await assert.rejects(service.invoke({ ...input, operation: "channels.list" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Slack propagates HTTP status, invalid registration and malformed token errors", async (t) => {
  const { service, state, connect } = await fixture(t);
  for (const [status, code] of [[401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"]]) {
    state.tokenStatus = status;
    state.tokenText = "secret-client";
    await assert.rejects(connect(), { code });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  state.tokenStatus = 200;
  await assert.rejects(connect(), { code: "connector_response_invalid" });
  state.tokenText = undefined;
  state.tokenResponse = { ok: false, error: "bad_client_secret" };
  await assert.rejects(connect(), { code: "connector_registration_invalid" });
});

test("Slack API throttling does not replay and revocation persists reconnect state", async (t) => {
  const { service, options, state, connect, requests } = await fixture(t);
  await connect();
  let before = requests.length;
  state.apiStatus = 429;
  await assert.rejects(service.invoke({ ...input, operation: "channels.list" }), { code: "connector_rate_limited" });
  assert.equal(requests.length, before + 1);
  assert.equal((await service.status(input)).status, "connected");
  state.apiStatus = 200;
  state.page = { ok: false, error: "token_revoked", detail: "secret-client" };
  await assert.rejects(service.invoke({ ...input, operation: "channels.list" }), { code: "connector_reconnect_required" });
  const restarted = createConnectionService(options);
  assert.equal((await restarted.status(input)).status, "reconnect-required");
  before = requests.length;
  await assert.rejects(restarted.invoke({ ...input, operation: "channels.list" }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, before);
});

test("Slack interruption and timeout do not report a completed connection", async (t) => {
  for (const [path, name, code] of [["/api/oauth.v2.access", "AbortError", "connector_cancelled"], ["/api/conversations.list", "TimeoutError", "connector_provider_timeout"]]) {
    const { service, state, start } = await fixture(t);
    const pending = await start();
    state.controller = new AbortController();
    state.interruptPath = path;
    state.interruptName = name;
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: pending.callbackUrl, signal: state.controller.signal }), { code });
    assert.equal((await service.status(input)).status, "disconnected");
  }
});


test("Slack useful history, user lookup and message posting retain actor authorization", async (t) => {
  for (const actor of ["user", "bot"]) {
    const { service, state, requests, connect } = await fixture(t, actor, [...scopes, "channels:history", "users:read", "chat:write"]);
    await connect();
    state.apiReply = (url, init) => {
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer secret-${actor}-access-1`);
      if (url.pathname === "/api/conversations.history") {
        assert.equal(url.searchParams.get("channel"), "C123");
        assert.equal(url.searchParams.get("cursor"), "next +&/=");
        return Response.json({ ok: true, messages: [{ ts: "1700000000.000001", text: "Appointment tomorrow" }], has_more: false });
      }
      if (url.pathname === "/api/users.info") {
        assert.equal(url.searchParams.get("user"), "U123");
        return Response.json({ ok: true, user: { id: "U123", name: "reception" } });
      }
      assert.equal(url.pathname, "/api/chat.postMessage");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), { channel: "C123", text: "Appointment confirmed", thread_ts: "1700000000.000001", unfurl_links: false, unfurl_media: false });
      return Response.json({ ok: true, channel: "C123", ts: "1700000001.000002", message: { text: "Appointment confirmed" } });
    };
    const history = await service.invoke({ ...input, operation: "channels.history", input: { channel: "C123", cursor: "next +&/=" } });
    assert.equal(history.messages[0].text, "Appointment tomorrow");
    assert.equal((await service.invoke({ ...input, operation: "users.info", input: { user: "U123" } })).user.name, "reception");
    assert.equal((await service.invoke({ ...input, operation: "messages.send", input: { channel: "C123", text: "Appointment confirmed", thread_ts: "1700000000.000001" } })).ts, "1700000001.000002");
    const before = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "channels.history", input: { channel: "C123", limit: 16 } }));
    await assert.rejects(service.invoke({ ...input, operation: "messages.send", input: { channel: "https://evil.test", text: "hello" } }));
    await assert.rejects(service.invoke({ ...input, operation: "groups.history", input: { channel: "G123" } }));
    assert.equal(requests.length, before);
  }
});


test("Slack signed events and interactions reject tampering, stale requests and other installations", () => {
  const base = { secret: "fixture-signing-secret", timestamp: "1700000000", now: 1700000000000, appId: "A123", teamId: "T123" };
  const event = { type: "event_callback", api_app_id: "A123", team_id: "T123", event_id: "Ev123", event: { type: "message", text: "hello" } };
  const signed = (payload, form = false) => {
    const rawBody = Buffer.from(form ? new URLSearchParams({ payload: JSON.stringify(payload) }).toString() : JSON.stringify(payload));
    return { ...base, rawBody, contentType: form ? "application/x-www-form-urlencoded" : "application/json", signature: "v0=" + createHmac("sha256", base.secret).update(`v0:${base.timestamp}:`).update(rawBody).digest("hex") };
  };
  assert.deepEqual(verifySlackRequest(signed(event)), event);
  const interaction = { type: "block_actions", api_app_id: "A123", team: { id: "T123" }, user: { id: "U123" }, actions: [{ action_id: "confirm" }] };
  assert.deepEqual(verifySlackRequest(signed(interaction, true)), interaction);
  assert.equal(verifySlackRequest(signed({ type: "url_verification", challenge: "challenge" })).challenge, "challenge");
  for (const request of [
    { ...signed(event), rawBody: Buffer.from("{}") }, { ...signed(event), now: base.now + 301000 },
    { ...signed(event), now: base.now - 301000 }, { ...signed(event), signature: "v0=no" },
    signed({ ...event, team_id: "TOTHER" }), signed({ ...event, api_app_id: "AOTHER" }),
    signed({ ...event, event_id: "" }), signed({ ...interaction, user: {} }, true)
  ]) assert.throws(() => verifySlackRequest(request), { code: "connector_webhook_invalid" });
});
