import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { twitchProvider, parseTwitchEventSubMessage } from "../src/server/twitch.js";

const callback = "https://app.example.test/twitch/callback";
const context = { applicationId: "app-one", subjectId: "user-one" };
const input = { context, integrationId: "twitch" };
const scopes = ["user:read:email", "user:read:follows"];
const followed = { total: 1, data: [{ broadcaster_id: "456", broadcaster_login: "channel", broadcaster_name: "Channel", followed_at: "2026-09-01T00:00:00Z" }], pagination: { cursor: "next +&2" } };

async function fixture(t, granted = scopes) {
  const directory = await mkdtemp(path.join(tmpdir(), "twitch-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const state = {
    time: Date.now(), tokenCount: 0, tokenScope: granted, tokenStatus: 200, validationStatus: 200, apiStatus: 200,
    validation: { client_id: "fixture-client", user_id: "123", login: "reader", scopes: granted, expires_in: 60 },
    profile: { data: [{ id: "123", login: "reader", email: "reader@example.test" }] }, followed
  };
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" });
  const options = {
    configuration: { schemaVersion: 1, integrations: {
      twitch: { provider: "twitch", accountMode: "per-user", scopes: granted, authentication: { method: "oauth2", registrationRef: "twitch" } }
    }, registrations: { twitch: { source: "own", clientId: "fixture-client", clientSecretRef: "env:TWITCH_SECRET", callbackUrlRef: "env:TWITCH_CALLBACK" } } },
    providers: [twitchProvider], authorize: async (owner) => owner, now: () => state.time,
    resolveReference: async (ref) => ref === "env:TWITCH_CALLBACK" ? callback : "fixture-client-secret",
    store: createFileConnectionStore({ directory, protection }),
    fetchImpl: async (address, init) => {
      const url = new URL(String(address));
      const headers = new Headers(init.headers);
      requests.push({ url, init, headers });
      assert.equal(init.redirect, url.pathname === "/oauth2/token" ? "manual" : "error");
      if (state.interruptPath === url.pathname) {
        state.controller.abort(new DOMException("fixture-client-secret", state.interruptName || "AbortError"));
        throw init.signal.reason;
      }
      if (url.pathname === "/oauth2/token") {
        assert.equal(url.origin, "https://id.twitch.tv");
        assert.equal(init.method, "POST");
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_id"), "fixture-client");
        assert.equal(body.get("client_secret"), "fixture-client-secret");
        if (body.get("grant_type") === "refresh_token") assert.equal(body.get("refresh_token"), `fixture-refresh-${state.tokenCount}+&%`);
        state.tokenCount += 1;
        if (state.tokenText !== undefined) return new Response(state.tokenText, { status: state.tokenStatus });
        return Response.json(state.tokenResponse ?? {
          access_token: `fixture-access-${state.tokenCount}`, refresh_token: `fixture-refresh-${state.tokenCount}+&%`,
          token_type: "bearer", expires_in: 60, scope: state.tokenScope
        }, { status: state.tokenStatus });
      }
      assert.equal(headers.get("Client-Id"), "fixture-client");
      assert.equal(headers.get("Authorization"), `Bearer fixture-access-${state.tokenCount}`);
      if (url.pathname === "/oauth2/validate") {
        assert.equal(init.method, "GET");
        assert.equal(url.origin, "https://id.twitch.tv");
        return Response.json(state.validation, { status: state.validationStatus });
      }
      assert.equal(url.origin, "https://api.twitch.tv");
      if (state.apiResponse !== undefined) return state.apiStatus === 204 ? new Response(null, { status: 204 }) : Response.json(state.apiResponse, { status: state.apiStatus });
      assert.equal(init.method, "GET");
      assert.ok(["/helix/users", "/helix/channels/followed"].includes(url.pathname));
      return Response.json(url.pathname === "/helix/users" ? state.profile : state.followed, { status: state.apiStatus });
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
  return { service, options, protection, directory, requests, state, start, connect };
}

test("Twitch exchanges code consent, validates client ownership, and persists encrypted user grants across restart", async (t) => {
  const { service, options, protection, directory, requests, state, start } = await fixture(t);
  const { url, callbackUrl } = await start();
  assert.equal(url.origin + url.pathname, "https://id.twitch.tv/oauth2/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "fixture-client");
  assert.equal(url.searchParams.get("redirect_uri"), callback);
  assert.equal(url.searchParams.get("scope"), scopes.join(" "));
  assert.equal(url.searchParams.has("client_secret"), false);
  const connected = await service.completeAuthorization({ ...input, callbackUrl });
  assert.equal(connected.status, "connected");
  assert.deepEqual(connected.grantedScopes, scopes);
  assert.deepEqual(requests.map(({ url }) => url.pathname), ["/oauth2/token", "/oauth2/validate"]);
  const code = new URLSearchParams(requests[0].init.body);
  assert.equal(code.get("grant_type"), "authorization_code");
  assert.equal(code.get("redirect_uri"), callback);
  assert.equal(code.get("code"), "fixture-code");
  for (const name of await readdir(directory)) {
    const text = await readFile(path.join(directory, name), "utf8");
    for (const secret of ["fixture-client-secret", "fixture-access-1", "fixture-refresh-1"]) assert.equal(text.includes(secret), false);
  }
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.status(input), { ...connected, callbackUrl: callback });
  assert.deepEqual(await restarted.invoke({ ...input, operation: "profile.read" }), state.profile);
  assert.deepEqual(requests.slice(-2).map(({ url }) => url.pathname), ["/oauth2/validate", "/helix/users"]);
  assert.equal(requests.at(-1).url.search, "");
  for (const owner of [{ ...context, applicationId: "other-app" }, { ...context, subjectId: "other-user" }]) {
    await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "profile.read" }), { code: "connector_reconnect_required" });
  }
  const changed = structuredClone(options.configuration);
  changed.registrations.twitch.clientId = "other-client";
  const count = requests.length;
  await assert.rejects(createConnectionService({ ...options, configuration: changed }).invoke({ ...input, operation: "profile.read" }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, count);
  await restarted.disconnect(input);
  assert.equal((await service.status(input)).status, "disconnected");
});

test("Twitch discovers streams/channels and updates only the validated broadcaster", async t => {
  const { service, requests, state, connect } = await fixture(t, [...scopes, "channel:manage:broadcast"]);
  await connect();
  state.apiResponse = { data: [{ id: "900", user_id: "456", title: "Grooming live", viewer_count: 42 }], pagination: { cursor: "next +&" } };
  assert.deepEqual(await service.invoke({ ...input, operation: "streams.list", input: { user_id: "456", first: 5, after: "next +&" } }), state.apiResponse);
  assert.equal(requests.at(-1).url.searchParams.get("after"), "next +&");
  state.apiResponse = { data: [{ id: "456", display_name: "Groomer", is_live: true }], pagination: {} };
  assert.deepEqual(await service.invoke({ ...input, operation: "channels.search", input: { query: "dogs & grooming", live_only: true } }), state.apiResponse);
  assert.equal(requests.at(-1).url.searchParams.get("query"), "dogs & grooming");
  state.apiResponse = { data: [{ broadcaster_id: "456", title: "Dog grooming" }] };
  assert.deepEqual(await service.invoke({ ...input, operation: "channels.read", input: { broadcaster_id: "456" } }), state.apiResponse);
  state.apiStatus = 204;
  const changes = { title: "  Dogs & grooming  ", game_id: "0", tags: ["Dogs", "Café"], is_branded_content: false };
  assert.equal(await service.invoke({ ...input, operation: "broadcast.update", input: changes }), null);
  assert.equal(requests.at(-1).init.method, "PATCH");
  assert.equal(requests.at(-1).url.searchParams.get("broadcaster_id"), "123");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), changes);
  for (const invalid of [{}, { broadcaster_id: "456", title: "Other user" }, { title: "" }, { tags: ["two words"] }]) {
    await assert.rejects(service.invoke({ ...input, operation: "broadcast.update", input: invalid }), { code: "connector_input_invalid" });
  }
  const before = requests.length;
  state.validation = { ...state.validation, scopes };
  await assert.rejects(service.invoke({ ...input, operation: "broadcast.update", input: { title: "Denied" } }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, before + 1); // validation only; no channel write
});

test("Twitch serializes refresh rotation, encodes reserved token characters and preserves verified permission reduction", async (t) => {
  const { service, options, state, connect } = await fixture(t);
  state.validation = { ...state.validation, scopes: ["user:read:follows"] };
  assert.deepEqual((await connect()).grantedScopes, ["user:read:follows"]);
  state.time += 40_000;
  state.tokenScope = scopes.join(" ");
  state.validation = { ...state.validation, scopes };
  await Promise.all([service.invoke({ ...input, operation: "channels.followed" }), service.invoke({ ...input, operation: "channels.followed" })]);
  assert.equal(state.tokenCount, 2);
  assert.deepEqual((await service.status(input)).grantedScopes, ["user:read:follows"]);
  const restarted = createConnectionService(options);
  state.time += 40_000;
  state.tokenScope = scopes;
  await restarted.invoke({ ...input, operation: "token.validate" });
  assert.equal(state.tokenCount, 3);
  await assert.rejects(restarted.invoke({ ...input, operation: "profile.read" }), { code: "connector_scope_missing" });
});

test("Twitch polls, predictions and chat use granted identities and preserve provider outcomes", async t => {
  const granted = [...scopes, "channel:manage:polls", "channel:manage:predictions", "user:write:chat"];
  const { service, requests, state, connect } = await fixture(t, granted);
  await connect();
  const choices = [{ title: "Morning" }, { title: "Evening" }];
  for (const [operation, values, method, endpoint] of [
    ["polls.create", { title: "Next stream?", choices, duration: 60 }, "POST", "polls"],
    ["polls.end", { id: "poll-one", status: "TERMINATED" }, "PATCH", "polls"],
    ["predictions.create", { title: "Which dog wins?", outcomes: choices, prediction_window: 60 }, "POST", "predictions"],
    ["predictions.end", { id: "prediction-one", status: "RESOLVED", winning_outcome_id: "morning" }, "PATCH", "predictions"]
  ]) {
    state.apiResponse = { data: [{ id: "result-one", broadcaster_id: "123", status: values.status || "ACTIVE" }] };
    assert.deepEqual(await service.invoke({ ...input, operation, input: values }), state.apiResponse);
    assert.equal(requests.at(-1).url.pathname, `/helix/${endpoint}`);
    assert.equal(requests.at(-1).init.method, method);
    assert.deepEqual(JSON.parse(requests.at(-1).init.body), { ...values, broadcaster_id: "123" });
  }
  for (const operation of ["polls.list", "predictions.list"]) {
    state.apiResponse = { data: [], pagination: { cursor: "next +&" } };
    assert.deepEqual(await service.invoke({ ...input, operation, input: { first: 5, after: "next +&" } }), state.apiResponse);
    assert.equal(requests.at(-1).url.searchParams.get("broadcaster_id"), "123");
    assert.equal(requests.at(-1).url.searchParams.get("after"), "next +&");
  }
  state.apiResponse = { data: [{ message_id: "", is_sent: false, drop_reason: { code: "automod_held", message: "Held" } }] };
  const chat = { broadcaster_id: "456", message: "  Hello & welcome  " };
  assert.equal((await service.invoke({ ...input, operation: "chat.send", input: chat })).data[0].is_sent, false);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { ...chat, sender_id: "123" });
  for (const [operation, values] of [
    ["polls.create", { title: "Question", choices: [{ title: "Only" }], duration: 60 }],
    ["predictions.end", { id: "prediction", status: "RESOLVED" }],
    ["predictions.end", { id: "prediction", status: "CANCELED", winning_outcome_id: "wrong" }],
    ["chat.send", { ...chat, sender_id: "456" }]
  ]) await assert.rejects(service.invoke({ ...input, operation, input: values }), { code: "connector_input_invalid" });
  const count = requests.length;
  state.validation = { ...state.validation, scopes };
  await assert.rejects(service.invoke({ ...input, operation: "chat.send", input: chat }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, count + 1);
});

test("Twitch supports both documented token-scope formats and rejects malformed successful grants", async (t) => {
  const { service, state, connect } = await fixture(t);
  for (const scope of [scopes, scopes.join(" "), [], ""]) {
    state.tokenScope = scope;
    const connected = await connect();
    assert.deepEqual(connected.grantedScopes, typeof scope === "string" ? scope.split(" ").filter(Boolean) : scope);
    await service.disconnect(input);
  }
  for (const scope of [null, {}, [1], ["user:read:email user:read:follows"], "user:read:email\nuser:read:follows"]) {
    state.tokenScope = scope;
    await assert.rejects(connect(), { code: "connector_response_invalid" });
    assert.equal((await service.status(input)).status, "disconnected");
  }
  state.tokenText = "not JSON";
  await assert.rejects(connect(), { code: "connector_response_invalid" });
});

test("Twitch EventSub parser binds notifications and control messages to the app's connection", () => {
  const owner = { broadcasterId: "123", sessionId: "socket-one", subscriptionIds: ["event-one"] };
  const message = { metadata: { message_id: "message-one", message_type: "notification", message_timestamp: "2026-09-13T00:00:00.123456789Z", subscription_type: "channel.poll.begin", subscription_version: "1" },
    payload: { subscription: { id: "event-one", status: "enabled", type: "channel.poll.begin", version: "1", condition: { broadcaster_user_id: "123" }, transport: { method: "websocket", session_id: "socket-one" } },
      event: { broadcaster_user_id: "123", id: "poll-one", title: "Choose a topic" } } };
  assert.deepEqual(parseTwitchEventSubMessage(JSON.stringify(message), owner), message);
  for (const wrong of [{ ...owner, broadcasterId: "456" }, { ...owner, sessionId: "other" }, { ...owner, subscriptionIds: [] }]) {
    assert.throws(() => parseTwitchEventSubMessage(JSON.stringify(message), wrong), { code: "connector_event_invalid" });
  }
  const revoked = structuredClone(message);
  revoked.metadata.message_type = "revocation";
  revoked.payload.subscription.status = "authorization_revoked";
  delete revoked.payload.event;
  assert.deepEqual(parseTwitchEventSubMessage(JSON.stringify(revoked), owner), revoked);
  const reconnect = { metadata: { ...message.metadata, message_type: "session_reconnect" }, payload: { session: { id: "socket-one", status: "reconnecting", reconnect_url: "wss://eventsub.wss.twitch.tv/ws?reconnect=opaque" } } };
  assert.deepEqual(parseTwitchEventSubMessage(JSON.stringify(reconnect), owner), reconnect);
  reconnect.payload.session.reconnect_url = "wss://attacker.example/ws";
  assert.throws(() => parseTwitchEventSubMessage(JSON.stringify(reconnect), owner), { code: "connector_event_invalid" });
  const welcome = { metadata: { ...message.metadata, message_type: "session_welcome" }, payload: { session: { id: "socket-new", status: "connected", keepalive_timeout_seconds: 10 } } };
  assert.deepEqual(parseTwitchEventSubMessage(JSON.stringify(welcome), owner), welcome);
  assert.throws(() => parseTwitchEventSubMessage("x".repeat(1048577), owner), { code: "connector_event_invalid" });
  assert.throws(() => parseTwitchEventSubMessage("{", owner), { code: "connector_event_invalid" });
});

test("Twitch EventSub uses owned WebSocket sessions, explicit events and validated grants", async t => {
  const { service, requests, state, connect } = await fixture(t, [...scopes, "channel:read:polls"]);
  await connect();
  const subscription = { id: "event-one", type: "channel.poll.begin", status: "enabled", transport: { method: "websocket", session_id: "socket-one" } };
  state.apiResponse = { data: [subscription], pagination: {} };
  assert.deepEqual(await service.invoke({ ...input, operation: "events.subscribe", input: { type: subscription.type, session_id: "socket-one" } }), state.apiResponse);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { type: subscription.type, version: "1", condition: { broadcaster_user_id: "123" }, transport: subscription.transport });
  await service.invoke({ ...input, operation: "events.list", input: { after: "next" } });
  assert.equal(requests.at(-1).url.searchParams.get("after"), "next");
  const before = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "events.subscribe", input: { type: "unknown.event", session_id: "socket-one" } }), { code: "connector_input_invalid" });
  await assert.rejects(service.invoke({ ...input, operation: "events.subscribe", input: { type: subscription.type, session_id: "socket-one", broadcaster_user_id: "456" } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, before);
  state.apiStatus = 204;
  assert.equal(await service.invoke({ ...input, operation: "events.delete", input: { id: "event-one" } }), null);
  assert.equal(requests.at(-1).init.method, "DELETE");
  state.validation.scopes = scopes;
  const deniedBefore = requests.filter(request => request.url.pathname === "/helix/eventsub/subscriptions").length;
  await assert.rejects(service.invoke({ ...input, operation: "events.subscribe", input: { type: subscription.type, session_id: "socket-one" } }), { code: "connector_reconnect_required" });
  assert.equal(requests.filter(request => request.url.pathname === "/helix/eventsub/subscriptions").length, deniedBefore);
});

test("Twitch schedule segment lifecycle uses the connected broadcaster and explicit recurrence", async t => {
  const { service, requests, state, connect } = await fixture(t, [...scopes, "channel:manage:schedule"]);
  await connect();
  state.apiResponse = { data: { broadcaster_id: "123", segments: [{ id: "segment-one", start_time: "2026-10-01T09:00:00Z", end_time: "2026-10-01T10:00:00Z" }] }, pagination: { cursor: "next" } };
  await service.invoke({ ...input, operation: "schedule.get", input: { broadcaster_id: "123", after: "next" } });
  assert.equal(requests.at(-1).url.searchParams.get("after"), "next");
  await service.invoke({ ...input, operation: "schedule.create", input: {
    start_time: "2026-10-01T09:00:00Z", timezone: "Australia/Perth", duration: 60, is_recurring: true, title: "Weekly stream"
  } });
  assert.equal(requests.at(-1).url.searchParams.get("broadcaster_id"), "123");
  assert.equal(JSON.parse(requests.at(-1).init.body).duration, "60");
  await service.invoke({ ...input, operation: "schedule.update", input: { id: "segment-one", is_canceled: true } });
  assert.equal(requests.at(-1).url.searchParams.get("id"), "segment-one");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { is_canceled: true });
  const before = requests.length;
  for (const values of [{ id: "segment-one" }, { id: "segment-one", duration: 29 }, { id: "segment-one", timezone: "not/a/zone" },
    { id: "segment-one", broadcaster_id: "456", title: "Wrong owner" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "schedule.update", input: values }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, before);
  state.apiStatus = 204;
  assert.equal(await service.invoke({ ...input, operation: "schedule.delete", input: { id: "segment-one" } }), null);
  assert.equal(requests.at(-1).init.method, "DELETE");
  assert.equal(requests.at(-1).init.body, undefined);
  const vacation = { is_vacation_enabled: true, vacation_start_time: "2026-10-01T00:00:00Z",
    vacation_end_time: "2026-10-08T00:00:00Z", timezone: "Australia/Perth" };
  assert.equal(await service.invoke({ ...input, operation: "schedule.vacation", input: vacation }), null);
  assert.equal(requests.at(-1).url.pathname, "/helix/schedule/settings");
  assert.equal(requests.at(-1).url.searchParams.get("broadcaster_id"), "123");
  assert.equal(requests.at(-1).url.searchParams.get("timezone"), "Australia/Perth");
  assert.equal(requests.at(-1).init.body, undefined);
  const beforeVacation = requests.length;
  for (const values of [{ is_vacation_enabled: true }, { ...vacation, vacation_end_time: vacation.vacation_start_time },
    { ...vacation, vacation_start_time: "2026-02-30T00:00:00Z" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "schedule.vacation", input: values }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, beforeVacation);
  assert.equal(await service.invoke({ ...input, operation: "schedule.vacation", input: { is_vacation_enabled: false } }), null);
  assert.equal(requests.at(-1).url.searchParams.get("is_vacation_enabled"), "false");
});

test("Twitch reward lifecycle binds the broadcaster and keeps redemption decisions explicit", async t => {
  const { service, requests, state, connect } = await fixture(t, [...scopes, "channel:manage:redemptions"]);
  await connect();
  const reward = { id: "reward-one", broadcaster_id: "123", title: "Choose a topic", cost: 100 };
  state.apiResponse = { data: [reward] };
  assert.deepEqual(await service.invoke({ ...input, operation: "rewards.create", input: { title: reward.title, cost: 100 } }), state.apiResponse);
  assert.equal(requests.at(-1).url.searchParams.get("broadcaster_id"), "123");
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { title: reward.title, cost: 100 });
  await service.invoke({ ...input, operation: "rewards.list", input: { only_manageable_rewards: true } });
  await service.invoke({ ...input, operation: "rewards.update", input: { id: reward.id, is_paused: true } });
  assert.equal(requests.at(-1).url.searchParams.get("id"), reward.id);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { is_paused: true });
  const limits = { is_max_per_stream_enabled: true, max_per_stream: 10,
    is_max_per_user_per_stream_enabled: true, max_per_user_per_stream: 2,
    is_global_cooldown_enabled: true, global_cooldown_seconds: 60 };
  await service.invoke({ ...input, operation: "rewards.update", input: { id: reward.id, ...limits } });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), limits);
  const redemption = { id: "redeem-one", broadcaster_id: "123", user_id: "456", status: "UNFULFILLED", reward };
  state.apiResponse = { data: [redemption], pagination: { cursor: "more" } };
  await service.invoke({ ...input, operation: "redemptions.list", input: { reward_id: reward.id } });
  assert.equal(requests.at(-1).url.searchParams.get("status"), "UNFULFILLED");
  state.apiResponse = { data: [{ ...redemption, status: "CANCELED" }] };
  await service.invoke({ ...input, operation: "redemptions.update", input: { reward_id: reward.id, id: redemption.id, status: "CANCELED" } });
  assert.equal(requests.at(-1).url.searchParams.get("reward_id"), reward.id);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { status: "CANCELED" });
  state.apiStatus = 204;
  assert.equal(await service.invoke({ ...input, operation: "rewards.delete", input: { id: reward.id } }), null);
  assert.equal(requests.at(-1).init.method, "DELETE");
  assert.equal(requests.at(-1).init.body, undefined);
  const before = requests.length;
  for (const [operation, values] of [["rewards.create", { title: "bad", cost: 0 }], ["rewards.update", { id: reward.id }],
    ["rewards.update", { id: reward.id, is_max_per_stream_enabled: true }],
    ["rewards.update", { id: reward.id, is_global_cooldown_enabled: true, global_cooldown_seconds: 604801 }],
    ["redemptions.update", { reward_id: reward.id, id: redemption.id, status: "UNFULFILLED" }], ["rewards.list", { broadcaster_id: "456" }]]) {
    await assert.rejects(service.invoke({ ...input, operation, input: values }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, before);
});

test("Twitch creates clips once and lets the application resolve pending clips", async t => {
  const { service, requests, state, connect } = await fixture(t, [...scopes, "clips:edit"]);
  await connect();
  state.apiResponse = { data: [{ id: "NewClip", edit_url: "https://clips.twitch.tv/NewClip/edit" }] };
  assert.deepEqual(await service.invoke({ ...input, operation: "clips.create", input: { broadcaster_id: "456" } }), state.apiResponse);
  assert.equal(requests.at(-1).url.searchParams.get("broadcaster_id"), "456");
  assert.equal(requests.at(-1).init.method, "POST");
  state.apiResponse = { data: [] };
  assert.deepEqual(await service.invoke({ ...input, operation: "clips.get", input: { id: "NewClip" } }), state.apiResponse);
  state.apiResponse = { data: [{ id: "NewClip", broadcaster_id: "456", url: "https://clips.twitch.tv/NewClip", title: "A useful moment" }] };
  assert.deepEqual(await service.invoke({ ...input, operation: "clips.get", input: { id: "NewClip" } }), state.apiResponse);
  assert.equal(requests.filter(request => request.url.pathname === "/helix/clips" && request.init.method === "POST").length, 1);
  const before = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "clips.create", input: { broadcaster_id: "bad" } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, before);
  state.apiResponse = { data: [{ id: "NewClip", edit_url: "https://untrusted.example/edit" }] };
  await assert.rejects(service.invoke({ ...input, operation: "clips.create", input: { broadcaster_id: "456" } }), { code: "connector_response_invalid" });
});

test("Twitch analytics preserve private report links and validate date windows without downloading", async t => {
  const { service, requests, state, connect } = await fixture(t, [...scopes, "analytics:read:extensions", "analytics:read:games"]);
  await connect();
  for (const [kind, identity] of [["extensions", "extension_id"], ["games", "game_id"]]) {
    state.apiResponse = { data: [{ [identity]: "report-owner", URL: "https://reports.example.test/report.csv?signature=private", type: "overview_v2",
      date_range: { started_at: "2026-08-01T00:00:00Z", ended_at: "2026-08-31T00:00:00Z" } }], pagination: { cursor: "next/report" } };
    assert.deepEqual(await service.invoke({ ...input, operation: `analytics.${kind}`, input: {
      [identity]: "report-owner", first: 5, after: "next/report", started_at: "2026-08-01T00:00:00Z", ended_at: "2026-08-31T00:00:00Z"
    } }), state.apiResponse);
    assert.equal(requests.at(-1).url.pathname, `/helix/analytics/${kind}`);
    assert.equal(requests.at(-1).url.searchParams.get(identity), "report-owner");
    const before = requests.length;
    for (const values of [{ started_at: "2026-08-01T00:00:00Z" },
      { started_at: "2026-08-02T00:00:00Z", ended_at: "2026-08-01T00:00:00Z" },
      { started_at: "2026-02-30T00:00:00Z", ended_at: "2026-03-01T00:00:00Z" }]) {
      await assert.rejects(service.invoke({ ...input, operation: `analytics.${kind}`, input: values }), { code: "connector_input_invalid" });
    }
    assert.equal(requests.length, before);
    state.apiResponse.data[0].URL = "http://reports.example.test/insecure";
    await assert.rejects(service.invoke({ ...input, operation: `analytics.${kind}` }), { code: "connector_response_invalid" });
    state.apiResponse = { data: [], pagination: {} };
    assert.deepEqual(await service.invoke({ ...input, operation: `analytics.${kind}` }), state.apiResponse);
  }
  assert.equal(requests.some(request => request.url.hostname === "reports.example.test"), false);
});

test("Twitch Bits leaderboard preserves ranking and rejects invalid inputs or records", async t => {
  const { service, requests, state, connect } = await fixture(t, [...scopes, "bits:read"]);
  await connect();
  state.apiResponse = { data: [{ user_id: "456", rank: 2, score: 1200 }], total: 1,
    date_range: { started_at: "2026-09-01T00:00:00Z", ended_at: "2026-10-01T00:00:00Z" } };
  assert.deepEqual(await service.invoke({ ...input, operation: "bits.leaderboard", input: {
    count: 5, period: "month", started_at: "2026-09-05T00:00:00Z", user_id: "456"
  } }), state.apiResponse);
  assert.equal(requests.at(-1).url.pathname, "/helix/bits/leaderboard");
  assert.equal(requests.at(-1).url.searchParams.get("user_id"), "456");
  assert.equal(requests.at(-1).url.searchParams.get("count"), "5");
  const before = requests.length;
  for (const values of [{ count: 101 }, { period: "hour" }, { started_at: "yesterday" }, { broadcaster_id: "456" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "bits.leaderboard", input: values }), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, before);
  state.apiResponse.data[0].score = -1;
  await assert.rejects(service.invoke({ ...input, operation: "bits.leaderboard" }), { code: "connector_response_invalid" });
});

test("Twitch channel reads bind protected account identities and preserve useful records", async t => {
  const granted = [...scopes, "channel:read:subscriptions", "user:read:subscriptions", "channel:read:vips", "channel:read:editors", "moderation:read", "moderator:read:followers", "moderator:read:chatters", "channel:read:hype_train"];
  const { service, requests, state, connect } = await fixture(t, granted);
  await connect();
  for (const [operation, endpoint, values, identity, response] of [
    ["subscriptions.list", "subscriptions", { user_id: "456" }, "broadcaster_id", { data: [{ user_id: "456", tier: "1000" }], pagination: { cursor: "next" } }],
    ["subscriptions.check", "subscriptions/user", { broadcaster_id: "456" }, "user_id", { data: [{ broadcaster_id: "456", tier: "1000" }] }],
    ["vips.list", "channels/vips", {}, "broadcaster_id", { data: [{ user_id: "456" }], pagination: {} }],
    ["editors.list", "channels/editors", {}, "broadcaster_id", { data: [{ user_id: "456" }] }],
    ["bannedUsers.list", "moderation/banned", {}, "broadcaster_id", { data: [{ user_id: "456", reason: "spam" }], pagination: {} }],
    ["moderators.list", "moderation/moderators", {}, "broadcaster_id", { data: [{ user_id: "456" }], pagination: {} }],
    ["followers.list", "channels/followers", {}, "broadcaster_id", { data: [{ user_id: "456" }], pagination: {}, total: 1 }],
    ["chatters.list", "chat/chatters", { broadcaster_id: "456" }, "moderator_id", { data: [{ user_id: "789" }], pagination: {}, total: 1 }],
    ["hypeTrain.status", "hypetrain/status", {}, "broadcaster_id", { data: [{ current: null, last: null }] }]
  ]) {
    state.apiResponse = response;
    assert.deepEqual(await service.invoke({ ...input, operation, input: values }), response);
    assert.equal(requests.at(-1).url.pathname, `/helix/${endpoint}`);
    assert.equal(requests.at(-1).url.searchParams.get(identity), "123");
  }
  const before = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "editors.list", input: { broadcaster_id: "456" } }), { code: "connector_input_invalid" });
  await assert.rejects(service.invoke({ ...input, operation: "chatters.list", input: { broadcaster_id: "456", moderator_id: "456" } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, before);
  state.apiResponse = { data: [{ user_id: "bad" }], pagination: {} };
  await assert.rejects(service.invoke({ ...input, operation: "vips.list" }), { code: "connector_response_invalid" });
});

test("Twitch rejects invalid user-token validation and mismatched profiles without connecting another account", async (t) => {
  const { service, state, connect, requests } = await fixture(t);
  const valid = structuredClone(state.validation);
  for (const patch of [{ client_id: "other-client" }, { user_id: null, login: null }, { expires_in: 0 }, { expires_in: 1.5 }, { scopes: "user:read:email" }, { scopes: [7] }, { user_id: "" }]) {
    state.validation = { ...valid, ...patch };
    await assert.rejects(connect(), { code: patch.client_id ? "connector_reconnect_required" : "connector_response_invalid" });
    assert.equal((await service.status(input)).status, "disconnected");
    assert.equal(requests.some(({ url }) => url.origin === "https://api.twitch.tv"), false);
  }
  state.validation = valid;
  await connect();
  state.profile = { data: [{ id: "999", login: "someone-else" }] };
  await assert.rejects(service.invoke({ ...input, operation: "profile.read" }), { code: "connector_response_invalid" });
  state.profile = { data: [] };
  await assert.rejects(service.invoke({ ...input, operation: "profile.read" }), { code: "connector_response_invalid" });
});

test("Twitch derives followed-channel user identity, bounds pages and preserves opaque cursors without auto-paging", async (t) => {
  const { service, state, connect, requests } = await fixture(t);
  await connect();
  let count = requests.length;
  assert.deepEqual(await service.invoke({ ...input, operation: "channels.followed", input: { first: 100, after: "next +&2", broadcaster_id: "456" } }), followed);
  assert.equal(requests.length, count + 2);
  assert.deepEqual(Object.fromEntries(requests.at(-1).url.searchParams), { first: "100", after: "next +&2", broadcaster_id: "456", user_id: "123" });
  count = requests.length;
  for (const invalid of [{ first: 0 }, { first: 101 }, { first: 1.5 }, { after: "" }, { after: "a".repeat(4097) }, { broadcaster_id: "a" }, { user_id: "999" }, { url: "https://attacker.invalid" }, { access_token: "raw" }]) {
    await assert.rejects(service.invoke({ ...input, operation: "channels.followed", input: invalid }), { code: "connector_input_invalid" });
  }
  await assert.rejects(service.invoke({ ...input, operation: "profile.read", input: { id: "999" } }), { code: "connector_input_invalid" });
  await assert.rejects(service.invoke({ ...input, operation: "token.validate", input: { token: "raw" } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  state.followed = { total: 0, data: [], pagination: {} };
  assert.deepEqual(await service.invoke({ ...input, operation: "channels.followed" }), state.followed);
  assert.equal(requests.at(-1).url.searchParams.get("first"), "20");
  for (const malformed of [{ ...followed, pagination: [] }, { ...followed, pagination: "cursor" }, { ...followed, pagination: null }, { ...followed, pagination: { cursor: 4 } }, { ...followed, total: -1 }, { ...followed, data: [{}] }]) {
    state.followed = malformed;
    await assert.rejects(service.invoke({ ...input, operation: "channels.followed" }), { code: "connector_response_invalid" });
  }
});

test("Twitch cancellation, denial, wrong-owner completion and callback replay never exchange an unauthorized code", async (t) => {
  const { service, start, requests, connect } = await fixture(t);
  const cancelled = await start();
  await service.cancelAuthorization({ ...input, state: cancelled.url.searchParams.get("state") });
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: cancelled.callbackUrl }), { code: "connector_attempt_invalid" });
  const denied = await start();
  const denial = new URL(denied.callbackUrl);
  denial.searchParams.delete("code");
  denial.searchParams.set("error", "access_denied");
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: denial.href }), { code: "connector_consent_denied" });
  const pending = await start();
  await assert.rejects(service.completeAuthorization({ ...input, context: { ...context, subjectId: "other-user" }, callbackUrl: pending.callbackUrl }), { code: "connector_attempt_invalid" });
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: pending.callbackUrl.replace("app.example.test", "other.example.test") }), { code: "connector_callback_invalid" });
  assert.equal(requests.length, 0);
  await service.completeAuthorization({ ...input, callbackUrl: pending.callbackUrl });
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: pending.callbackUrl }), { code: "connector_attempt_invalid" });
  assert.equal(requests.length, 2);
  await connect();
});

test("Twitch validation detects revoked tokens and scopes before Helix and records reconnect state", async (t) => {
  const { service, state, connect, requests } = await fixture(t);
  for (const failure of ["token", "scope"]) {
    state.validationStatus = 200;
    state.validation = { ...state.validation, scopes };
    await connect();
    if (failure === "token") state.validationStatus = 401;
    else state.validation = { ...state.validation, scopes: ["user:read:email"] };
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "channels.followed" }), { code: "connector_reconnect_required" });
    assert.equal(requests.length, count + 1);
    assert.equal(requests.at(-1).url.pathname, "/oauth2/validate");
    assert.equal((await service.status(input)).status, "reconnect-required");
  }
});

test("Twitch maps validation and API failures without retries or credential disclosure", async (t) => {
  const { service, state, connect, requests } = await fixture(t);
  await connect();
  for (const target of ["validation", "api"]) {
    for (const [status, code] of [[403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
      state.validationStatus = target === "validation" ? status : 200;
      state.apiStatus = target === "api" ? status : 200;
      const count = requests.length;
      await assert.rejects(service.invoke({ ...input, operation: "channels.followed" }), (error) => {
        assert.equal(error.code, code);
        assert.equal(JSON.stringify(error).includes("fixture-"), false);
        return true;
      });
      assert.equal(requests.length, count + (target === "validation" ? 1 : 2));
    }
  }
  state.validationStatus = 200;
  state.apiStatus = 401;
  await assert.rejects(service.invoke({ ...input, operation: "channels.followed" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Twitch handles documented invalid-refresh errors and preserves non-JSON token error status", async (t) => {
  const { service, state, connect, requests } = await fixture(t);
  await connect();
  state.time += 40_000;
  state.tokenStatus = 400;
  state.tokenResponse = { error: "Bad Request", status: 400, message: "Invalid refresh token" };
  const count = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "token.validate" }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, count + 1);
  assert.equal((await service.status(input)).status, "reconnect-required");
  for (const [status, code] of [[401, "connector_reconnect_required"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.tokenStatus = status;
    state.tokenText = "fixture-client-secret";
    await assert.rejects(connect(), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes("fixture-client-secret"), false);
      return true;
    });
  }
});

test("Twitch propagates interruption across validation and Helix without continuing or replaying", async (t) => {
  const { service, state, connect, requests } = await fixture(t);
  await connect();
  for (const interruptPath of ["/oauth2/validate", "/helix/channels/followed"]) {
    for (const [name, code] of [["AbortError", "connector_cancelled"], ["TimeoutError", "connector_provider_timeout"]]) {
      state.controller = new AbortController();
      state.interruptPath = interruptPath;
      state.interruptName = name;
      const count = requests.length;
      await assert.rejects(service.invoke({ ...input, operation: "channels.followed", signal: state.controller.signal }), { code });
      assert.equal(requests.length, count + (interruptPath === "/oauth2/validate" ? 1 : 2));
      assert.equal((await service.status(input)).status, "connected");
    }
  }
});
