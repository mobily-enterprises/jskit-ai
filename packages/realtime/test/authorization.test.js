import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { io as connect } from "socket.io-client";
import { createSocketIoServer, closeSocketIoServer } from "../src/server/runtime.js";
import { createRealtimeDelivery } from "../src/server/realtimeDelivery.js";
import { registerSocketAudienceBootstrap } from "../src/server/realtimeAudience.js";

const logger = { debug() {}, warn() {} };
const event = {
  type: "entity.changed", entity: "session", entityId: "s1",
  meta: { secret: "server-only" },
  realtime: {
    audience: ["all_clients", { userId: 1 }], event: "conversation.changed",
    payload: { projectSlug: "private", conversationLogPatch: { text: "private answer" } }
  }
};

test("invalid authorization configuration fails closed at startup", () => {
  const io = { emit() {}, to() {} };
  assert.throws(() => createRealtimeDelivery({ io, logger, authService: {
    authenticateRequest() {}, realtime: { authorizeEvent: true }
  } }), /authorizeEvent must be a function/u);
  assert.throws(() => createRealtimeDelivery({ io, logger, authService: {
    realtime: { requireAuthentication: true }
  } }), /authenticateRequest/u);
});

test("real sockets authorize each conversation delivery and disconnect a revoked session", async (t) => {
  const httpServer = createServer();
  const io = createSocketIoServer({ httpServer });
  const users = new Map([["allowed", { id: "1" }], ["denied", { id: "2" }]]);
  let permitted = "1";
  const authService = {
    realtime: {
      requireAuthentication: true,
      authorizeEvent: ({ actor }) => actor.id === permitted
    },
    async authenticateRequest(request) {
      const actor = users.get(request.cookies.session);
      return { authenticated: Boolean(actor), actor };
    }
  };
  registerSocketAudienceBootstrap({ io, authService, logger });
  const delivery = createRealtimeDelivery({ io, authService, logger });
  delivery.start();
  t.after(async () => { delivery.stop(); await closeSocketIoServer(io); });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  const received = { allowed: [], denied: [] };
  const clients = {};
  for (const session of ["allowed", "denied"]) {
    const socket = connect(url, { transports: ["websocket"], extraHeaders: { Cookie: `session=${session}` }, reconnection: false });
    clients[session] = socket;
    t.after(() => socket.disconnect());
    socket.on("conversation.changed", (payload) => received[session].push(payload));
    await once(socket, "connect");
  }
  const answer = once(clients.allowed, "conversation.changed");
  await delivery.handle(event);
  await answer;
  assert.equal(received.allowed.length, 1);
  assert.equal(received.allowed[0].conversationLogPatch.text, "private answer");
  assert.equal(Object.hasOwn(received.allowed[0], "meta"), false);
  assert.equal(received.denied.length, 0);
  permitted = "2";
  const nextAnswer = once(clients.denied, "conversation.changed");
  await delivery.handle(event);
  await nextAnswer;
  assert.equal(received.allowed.length, 1);
  users.delete("denied");
  const disconnected = once(clients.denied, "disconnect");
  await delivery.handle(event);
  await disconnected;
  assert.equal(received.denied.length, 1);
});

test("idle socket sessions are revalidated without an application event", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const socket = { data: { actorId: "1" }, handshake: {}, disconnect() { this.connected = false; }, connected: true };
  const io = { emit() {}, to() {}, on() {}, off() {}, sockets: { sockets: new Map([["s1", socket]]) } };
  const delivery = createRealtimeDelivery({ io, logger, authService: {
    realtime: { requireAuthentication: true },
    async authenticateRequest() { return { authenticated: false }; }
  } });
  t.after(() => delivery.stop());
  delivery.start();
  t.mock.timers.tick(30_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.connected, false);
});

test("delivery failures never reject a committed mutation and room unions emit once", async () => {
  const warnings = [];
  const io = { emit() { throw new Error("transport down"); }, to() { throw new Error("transport down"); } };
  const delivery = createRealtimeDelivery({ io, logger: { debug() {}, warn(value) { warnings.push(value); } } });
  await assert.doesNotReject(delivery.handle(event));
  await assert.doesNotReject(delivery.handle({ ...event, realtime: { ...event.realtime, payload: "invalid" } }));
  assert.equal(warnings.length, 2);
});

test("Redis peer deliveries authorize the receiving server's sockets without rebroadcasting", async () => {
  const delivered = [];
  const peerHandlers = new Map();
  const socket = {
    connected: true, data: { actorId: "2" }, handshake: {}, rooms: new Set(["users", "user:2"]),
    disconnect() { this.connected = false; },
    emit(name, payload) { delivered.push({ name, payload }); }
  };
  let allowed = false;
  const authService = {
    realtime: { requireAuthentication: true, authorizeEvent: () => allowed },
    async authenticateRequest() { return { authenticated: true, actor: { id: "2" } }; }
  };
  const peer = createRealtimeDelivery({ logger, authService, io: {
    emit() { assert.fail("must authorize individual sockets"); }, to() {},
    sockets: { sockets: new Map([["peer-socket", socket]]) },
    on(name, handler) { peerHandlers.set(name, handler); },
    off(name) { peerHandlers.delete(name); },
    serverSideEmit() { assert.fail("must not rebroadcast a received event"); }
  } });
  const pending = [];
  const origin = createRealtimeDelivery({ logger, authService, io: {
    emit() {}, to() {}, sockets: { sockets: new Map() }, on() {}, off() {},
    serverSideEmit(name, envelope) { pending.push(peerHandlers.get(name)(structuredClone(envelope))); }
  } });
  peer.start({ redisConfigured: true });
  origin.start({ redisConfigured: true });
  try {
    await origin.handle(event);
    await Promise.all(pending);
    assert.equal(delivered.length, 0);
    allowed = true;
    await origin.handle(event);
    await Promise.all(pending);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].payload.conversationLogPatch.text, "private answer");
  } finally {
    origin.stop();
    peer.stop();
  }
});
