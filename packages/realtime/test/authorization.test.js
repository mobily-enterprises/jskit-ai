import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { io as connect } from "socket.io-client";
import { createSocketIoServer, closeSocketIoServer } from "../src/server/runtime.js";
import { createRealtimeDelivery } from "../src/server/realtimeDelivery.js";
import { createAudienceContributors, registerSocketAudienceBootstrap } from "../src/server/realtimeAudience.js";

const logger = { debug() {}, warn() {} };

// A wait that fails instead of hanging when the event never comes.
const arrival = (emitter, name) => once(emitter, name, { signal: AbortSignal.timeout(5_000) });

// Real sockets whose session cookies name their actors. `checks` lists each
// authentication's session cookie, so a test sees which sockets were checked.
async function signedInSockets(t, { audiences = null } = {}) {
  const httpServer = createServer();
  const io = createSocketIoServer({ httpServer });
  const sessions = new Map();
  const checks = [];
  const authService = {
    realtime: { requireAuthentication: true },
    async authenticateRequest(request) {
      checks.push(request.cookies.session);
      const id = sessions.get(request.cookies.session);
      return { authenticated: Boolean(id), actor: id ? { id } : null };
    }
  };
  registerSocketAudienceBootstrap({ io, authService, logger, audiences });
  const delivery = createRealtimeDelivery({ io, authService, logger, audiences });
  delivery.start();
  t.after(async () => {
    delivery.stop();
    await closeSocketIoServer(io);
    httpServer.closeAllConnections();
    await new Promise((resolve) => httpServer.close(resolve));
  });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  return {
    checks,
    sessions,
    io,
    publish: (audience, name = "item.changed") => delivery.handle({
      type: "entity.changed", realtime: { audience, event: name, payload: { name } }
    }),
    async connect(session) {
      const client = connect(url, { transports: ["websocket"], extraHeaders: { Cookie: `session=${session}` }, reconnection: false });
      t.after(() => client.disconnect());
      const received = [];
      client.on("item.changed", (payload) => received.push(payload));
      await arrival(client, "connect");
      return { client, received };
    }
  };
}

// Events on one connection arrive in order, so once a later marker arrives an
// earlier event that was not received was never sent.
async function afterMarker(f, userId, ...clients) {
  const markers = clients.map((client) => arrival(client, "marker"));
  await f.publish({ userId }, "marker");
  await Promise.all(markers);
}

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
  t.after(async () => {
    delivery.stop();
    await closeSocketIoServer(io);
    httpServer.closeAllConnections();
    await new Promise((resolve) => httpServer.close(resolve));
  });
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

test("guarded delivery checks only the sockets that can receive an event, once per login", async (t) => {
  const f = await signedInSockets(t);
  f.sessions.set("alice", "1").set("bob", "2").set("carol", "3");
  const [aliceTab, aliceOtherTab] = [await f.connect("alice"), await f.connect("alice")];
  await f.connect("bob");
  await f.connect("carol");

  f.checks.length = 0;
  const reached = [arrival(aliceTab.client, "item.changed"), arrival(aliceOtherTab.client, "item.changed")];
  await f.publish({ userId: 1 });
  await Promise.all(reached);
  assert.deepEqual(f.checks, ["alice"], "Only Alice's tabs can receive, and they share one login check");

  f.checks.length = 0;
  await f.publish("all_clients");
  assert.deepEqual(f.checks.sort(), ["alice", "bob", "carol"], "A broadcast checks each login once");

  // The shared check still stops a revoked login on the very next publish.
  await afterMarker(f, 1, aliceTab.client, aliceOtherTab.client);
  f.sessions.delete("alice");
  const received = aliceTab.received.length + aliceOtherTab.received.length;
  const disconnected = [arrival(aliceTab.client, "disconnect"), arrival(aliceOtherTab.client, "disconnect")];
  await f.publish({ userId: 1 });
  await Promise.all(disconnected);
  assert.equal(aliceTab.received.length + aliceOtherTab.received.length, received);
});

test("membership changes and revoked logins take effect on the very next publish", async (t) => {
  const memberships = new Map([["1", [7]], ["2", []]]);
  const audiences = createAudienceContributors();
  audiences.register({
    id: "test.memberships",
    resolveActorScopes: (actorId) => (memberships.get(actorId) || []).map((id) => ({ kind: "workspace", id }))
  });
  const f = await signedInSockets(t, { audiences });
  f.sessions.set("alice", "1").set("bob", "2");
  const alice = await f.connect("alice");
  const bob = await f.connect("bob");

  await f.publish({ workspaceId: 7 });
  await afterMarker(f, 1, alice.client);
  await afterMarker(f, 2, bob.client);
  assert.equal(alice.received.length, 1);
  assert.equal(bob.received.length, 0);

  // Granted: Bob was outside the room, and still receives the next publish.
  memberships.set("2", [7]);
  const granted = arrival(bob.client, "item.changed");
  await f.publish({ workspaceId: 7 });
  await granted;

  // Removed: Alice was inside the room, and does not receive the next publish.
  await afterMarker(f, 1, alice.client);
  const aliceReceived = alice.received.length;
  memberships.set("1", []);
  await f.publish({ workspaceId: 7 });
  await afterMarker(f, 1, alice.client);
  assert.equal(alice.received.length, aliceReceived);

  // A room no contributor can name is still checked only for its members.
  const bobSocket = [...f.io.sockets.sockets.values()].find((socket) => socket.data.actorId === "2");
  await bobSocket.join("live");
  f.checks.length = 0;
  await f.publish({ room: "live" });
  assert.deepEqual(f.checks, ["bob"]);

  // Revoked: Bob is disconnected instead of receiving the next publish.
  await afterMarker(f, 2, bob.client);
  f.sessions.delete("bob");
  const received = bob.received.length;
  const disconnected = arrival(bob.client, "disconnect");
  await f.publish({ workspaceId: 7 });
  await disconnected;
  assert.equal(bob.received.length, received);
});

test("idle socket sessions are revalidated without an application event, once per login", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tab = () => ({ data: { actorId: "1" }, handshake: {}, disconnect() { this.connected = false; }, connected: true });
  const sockets = [tab(), tab()];
  const io = { emit() {}, to() {}, on() {}, off() {}, sockets: { sockets: new Map(sockets.map((socket, index) => [`s${index}`, socket])) } };
  let checks = 0;
  const delivery = createRealtimeDelivery({ io, logger, authService: {
    realtime: { requireAuthentication: true },
    async authenticateRequest() { checks += 1; return { authenticated: false }; }
  } });
  t.after(() => delivery.stop());
  delivery.start();
  t.mock.timers.tick(30_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sockets.map((socket) => socket.connected), [false, false]);
  assert.equal(checks, 1, "Identical handshakes share one check per pass");
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
