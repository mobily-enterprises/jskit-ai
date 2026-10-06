import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import test from "node:test";
import Fastify from "fastify";
import { createConversationRuntime, createMemoryConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { createSocketIoClient } from "@jskit-ai/realtime/client/runtime";
import { registerFastifyConversations } from "../src/server/registerFastifyConversations.js";
import { ASSISTANT_CONVERSATION_EVENT, ASSISTANT_CONVERSATION_SUBSCRIBE } from "../src/shared/conversationRealtime.js";

const config = {
  surfaceDefinitions: { home: { enabled: true, requiresWorkspace: false } },
  assistantSurfaces: { home: { settingsSurfaceId: "home", configScope: "global" } }
};
const route = id => `/api/assistant/home/conversations/${encodeURIComponent(id)}`;

function subscribe(socket, id, extra = {}) {
  return new Promise((resolve, reject) => socket.timeout(5_000).emit(ASSISTANT_CONVERSATION_SUBSCRIBE, {
    subscriptionId: `view-${id}`, conversationId: id, targetSurfaceId: "home", hostSurfaceId: "home", ...extra
  }, (error, response) => error ? reject(error) : resolve(response)));
}

async function until(changes, predicate) {
  while (!predicate()) await once(changes, "change", { signal: AbortSignal.timeout(5_000) });
}

test("Fastify conversations await trusted authentication across HTTP and shared sockets without owning the runtime", { timeout: 20_000 }, async t => {
  const trusted = { actor: { id: "42" }, applicationId: "host-application", policy: { owner: "server" } };
  const sessions = new Map([["owner-session", trusted]]);
  const authorizations = [];
  const authenticated = [];
  const ids = ["planning", "notes"];
  const changes = new EventEmitter();
  const packets = [];
  let providerRequests = 0;
  const runtime = createConversationRuntime({
    storage: createMemoryConversationStorage(),
    authorize(input) {
      authorizations.push(input);
      return input.context.actor?.id === trusted.actor.id && input.context.policy === trusted.policy &&
        input.context.applicationId === trusted.applicationId && ids.includes(input.conversationId);
    },
    connections: { async resolve() {
      return { providerId: "test", model: "test-model", sdkPackage: "@ai-sdk/openai-compatible",
        apiKey: "test", baseURL: "http://test.invalid/v1" };
    } },
    // The existing subscriptions fixture's API SSE boundary, with completed
    // replies: the real driver, runtime, HTTP actions and sockets run unchanged.
    fetch: async () => {
      const index = providerRequests++;
      const chunks = [{ content: `Reply for ${ids[index]}.` }, {}].map((delta, chunk) => ({
        id: `reply-${index}`, object: "chat.completion.chunk", created: 1, model: "test-model",
        choices: [{ index: 0, delta, finish_reason: chunk ? "stop" : null }]
      }));
      return new Response(chunks.map(value => `data: ${JSON.stringify(value)}\n\n`).join(""),
        { headers: { "content-type": "text/event-stream" } });
    }
  });
  const app = Fastify();
  let socket;
  t.after(async () => {
    socket?.disconnect();
    try { await app.close(); }
    finally { await runtime.close(); }
  });
  const conversations = new Map();
  for (const id of ids) conversations.set(id, await runtime.open({ id, context: trusted,
    configuration: { integrationId: "test", systemPrompt: "Answer briefly." } }));
  authorizations.length = 0;
  await registerFastifyConversations(app, { runtime, config, env: {},
    async authenticate(request) {
      await Promise.resolve();
      authenticated.push(request);
      const session = request.cookies?.session || request.headers?.cookie?.match(/(?:^|;\s*)session=([^;]*)/u)?.[1];
      return sessions.get(session) || null;
    },
    bootstrap({ request, context }) {
      assert.equal(context, trusted);
      assert.equal(request.headers.cookie, "session=owner-session");
      return { host: { actorId: context.actor.id, applicationId: context.applicationId } };
    }
  });
  const url = await app.listen({ host: "127.0.0.1", port: 0 });
  let connections = 0;
  app.server.on("connection", () => { connections++; });
  const headers = { cookie: "session=owner-session", "x-jskit-surface": "home" };
  for (const path of ["/api/bootstrap", route(ids[0])]) {
    const denied = await app.inject({ method: "GET", url: path, headers: { "x-jskit-surface": "home" } });
    assert.equal(denied.statusCode, 401, denied.body);
  }
  assert.equal(authorizations.length, 0, "missing authentication never reaches the caller's runtime");
  const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap", headers });
  assert.equal(bootstrap.statusCode, 200, bootstrap.body);
  assert.deepEqual(bootstrap.json().host, { actorId: "42", applicationId: "host-application" });

  socket = createSocketIoClient({ url, options: {
    transports: ["websocket"], autoConnect: false, reconnection: false,
    extraHeaders: { Cookie: "session=owner-session" }
  } });
  socket.on(ASSISTANT_CONVERSATION_EVENT, packet => { packets.push(packet); changes.emit("change"); });
  const connected = once(socket, "connect", { signal: AbortSignal.timeout(5_000) });
  socket.connect();
  await connected;
  const connectionId = socket.id;
  const forged = { actor: { id: "forged" }, applicationId: "wire-application", policy: { owner: "wire" },
    context: { actor: { id: "forged" }, applicationId: "wire-application", policy: { owner: "wire" } } };
  for (const id of ids) {
    const subscription = await subscribe(socket, id, { ...forged,
      headers: { cookie: "session=forged-session" }, requestPolicy: "authenticated",
      subscribeActionId: "wire.subscribe", room: "wire-room" });
    assert.equal(subscription.ok, true, subscription.error);
    assert.equal(subscription.state.id, id);
    assert.deepEqual(subscription.state.conversationLog, []);
    const forgedSend = await app.inject({ method: "POST", url: `${route(id)}/messages`, headers,
      payload: { messageId: `question-${id}`, text: `Question for ${id}.`, ...forged } });
    assert.equal(forgedSend.statusCode, 400, "HTTP schema rejects caller-supplied identity fields");
    assert.equal(providerRequests, ids.indexOf(id), "rejected forged fields cannot dispatch a turn");
    const sent = await app.inject({ method: "POST", url: `${route(id)}/messages`, headers,
      payload: { messageId: `question-${id}`, text: `Question for ${id}.` } });
    assert.equal(sent.statusCode, 202, sent.body);
    const state = await conversations.get(id).wait();
    assert.equal(state.status, "ready", state.error);
    assert.equal(state.conversationLog.length, 1);
    assert.equal(state.conversationLog[0].user.text, `Question for ${id}.`);
    assert.equal(state.conversationLog[0].assistant.text, `Reply for ${id}.`);
  }
  await until(changes, () => ids.every(id => packets.some(packet => packet.subscriptionId === `view-${id}` &&
    packet.event.type === "message" && packet.event.text === `Reply for ${id}.`)));
  assert.equal(connections, 1);
  assert.equal(socket.id, connectionId);
  assert.ok(packets.every(packet => packet.subscriptionId === `view-${packet.conversationId}`));
  for (const id of ids) {
    assert.ok(authorizations.some(input => input.conversationId === id && input.operation === "subscribe"));
    assert.ok(authorizations.some(input => input.conversationId === id && input.operation === "send"));
  }
  for (const { context } of authorizations) {
    assert.deepEqual(context.actor, trusted.actor);
    assert.equal(context.policy, trusted.policy);
    assert.equal(context.applicationId, trusted.applicationId);
  }
  assert.ok(authenticated.some(request => request.method === "POST"));
  assert.ok(authenticated.some(request => request.method === undefined), "socket requests also use the async authenticator");

  sessions.delete("owner-session");
  for (const path of ["/api/bootstrap", route(ids[0])]) {
    const denied = await app.inject({ method: "GET", url: path, headers });
    assert.equal(denied.statusCode, 401, denied.body);
  }
  const deniedSend = await app.inject({ method: "POST", url: `${route(ids[0])}/messages`, headers,
    payload: { messageId: "revoked-attempt", text: "Never dispatch." } });
  assert.equal(deniedSend.statusCode, 401, deniedSend.body);
  const deniedSubscription = await subscribe(socket, ids[0], {
    subscriptionId: "after-revocation", actor: trusted.actor, context: trusted,
    headers: { cookie: "session=owner-session" }
  });
  assert.equal(deniedSubscription.ok, false);
  assert.equal(deniedSubscription.status, 401);
  assert.equal(providerRequests, 2, "wire credentials cannot dispatch after the host session is revoked");
  assert.equal(socket.connected, true);
  assert.equal(socket.id, connectionId);

  const disconnected = once(socket, "disconnect", { signal: AbortSignal.timeout(5_000) });
  await app.close();
  await disconnected;
  assert.equal(app.server.listening, false);
  assert.equal(socket.connected, false);
  const retained = await runtime.open({ id: ids[0], context: trusted });
  assert.equal((await retained.read()).conversationLog[0].assistant.text, "Reply for planning.");
  await retained.configure({ systemPrompt: "The caller still owns this runtime." });
});
