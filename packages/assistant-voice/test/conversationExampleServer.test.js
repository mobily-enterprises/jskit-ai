import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSocketIoClient } from "@jskit-ai/realtime/client/runtime";

// Deny these modules before importing the actual example and its provider graph.
// A database installed elsewhere in the monorepo must not mask this dependency.
const forbiddenImports = [];
registerHooks({ resolve(specifier, context, nextResolve) {
  if (["@jskit-ai/database-runtime", "knex"].some(name => specifier === name || specifier.startsWith(`${name}/`))) {
    forbiddenImports.push(specifier);
    throw new Error(`The file-backed example must not import ${specifier}.`);
  }
  return nextResolve(specifier, context);
} });
const { createExampleServer } = await import("../examples/conversation/server.js");

const origin = "http://127.0.0.1:5176";
const ids = ["planning", "notes", "research", "writing", "review"];
const options = { timeout: 20_000 };
const base = id => `/api/assistant/home/conversations/${encodeURIComponent(id)}`;

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "voice-example-server-"));
  const clients = [];
  let application;
  let connections = 0;
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Reading or subscribing to the example must not invoke provider inference.");
  });
  t.after(async () => {
    for (const client of clients) client.disconnect();
    try { await application?.app.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
    assert.equal(fetch.mock.callCount(), 0);
    assert.deepEqual(forbiddenImports, []);
  });
  application = await createExampleServer({ env: {
    APP_ORIGIN: origin, ASSISTANT_ENGINE: "api", ASSISTANT_STORAGE_DIRECTORY: directory,
    ASSISTANT_WORKDIR: directory
  } });
  const url = await application.app.listen({ host: "127.0.0.1", port: 0 });
  application.app.server.on("connection", () => { connections++; });
  async function connect(header = origin) {
    const socket = createSocketIoClient({ url, options: {
      transports: ["websocket"], reconnection: false, autoConnect: false,
      ...(header === null ? {} : { extraHeaders: { Origin: header } })
    } });
    clients.push(socket);
    const connected = once(socket, "connect", { signal: AbortSignal.timeout(5_000) });
    socket.connect();
    await connected;
    return socket;
  }
  async function stored() {
    return Promise.all((await readdir(directory)).map(async name => JSON.parse(await readFile(join(directory, name), "utf8"))));
  }
  return { ...application, connect, stored, connections: () => connections };
}

function command(socket, event, input) {
  return new Promise((resolve, reject) => socket.timeout(5_000).emit(event, input,
    (error, response) => error ? reject(error) : resolve(response)));
}
function subscribe(socket, id, extra = {}) {
  return command(socket, "assistant.conversation.subscribe", {
    subscriptionId: `view-${id}`, conversationId: id, targetSurfaceId: "home", hostSurfaceId: "home", ...extra
  });
}

// Existing supplied-integration cases are retained in assistant-runtime. This
// consumer proof exercises the real example rather than copying their fixtures.
test("voice example serves its five file-backed identities without database or provider inference", options, async t => {
  const f = await fixture(t);
  const bootstrap = await f.app.inject({ method: "GET", url: "/api/bootstrap" });
  assert.equal(bootstrap.statusCode, 200);
  assert.equal(bootstrap.json().example.subjectId, "local-user");
  assert.deepEqual(bootstrap.json().example.conversations.map(value => value.id), ids);
  for (const id of ids) {
    const response = await f.app.inject({ method: "GET", url: base(id), headers: { "x-jskit-surface": "home" } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().id, id);
    assert.equal(response.json().status, "ready");
    assert.deepEqual(response.json().conversationLog, []);
  }
  for (const id of ["unknown", "headless"]) {
    const read = await f.app.inject({ method: "GET", url: base(id), headers: { "x-jskit-surface": "home" } });
    assert.equal(read.statusCode, 403, read.body);
    const send = await f.app.inject({ method: "POST", url: `${base(id)}/messages`,
      headers: { origin, "x-jskit-surface": "home" }, payload: { messageId: "browser-attempt", text: "Never dispatch." } });
    assert.equal(send.statusCode, 403, send.body);
  }
  const records = await f.stored();
  assert.deepEqual(records.map(record => record.scope).sort(), [...ids].sort());
  assert.ok(records.every(record => record.turns.length === 0));
});

test("voice example applies its explicit Origin boundary to real HTTP and reconstructed socket requests", options, async t => {
  const f = await fixture(t);
  for (const url of ["/api/bootstrap", base("planning")]) {
    const response = await f.app.inject({ method: "GET", url, headers: { origin: "https://foreign.invalid", "x-jskit-surface": "home" } });
    assert.equal(response.statusCode, 403, response.body);
  }
  for (const suppliedOrigin of [null, "https://foreign.invalid"]) {
    const response = await f.app.inject({ method: "POST", url: `${base("planning")}/cancel`,
      headers: { "x-jskit-surface": "home", ...(suppliedOrigin ? { origin: suppliedOrigin } : {}) } });
    assert.equal(response.statusCode, 403, response.body);
    const socket = await f.connect(suppliedOrigin);
    const subscription = await subscribe(socket, "planning", {
      // The wire payload cannot replace the connection's reconstructed request.
      method: "GET", headers: { origin }, requestPolicy: "authenticated", actionId: "example.conversation.subscribe",
      actor: { id: "42" }, context: { applicationId: "talking-assistant-example", subjectId: "local-user" }, room: "clients"
    });
    assert.equal(subscription.ok, false);
    assert.equal(subscription.status, 403);
    assert.match(subscription.error, /configured origin/);
    socket.disconnect();
  }
  const cancelled = await f.app.inject({ method: "POST", url: `${base("planning")}/cancel`, headers: { origin, "x-jskit-surface": "home" } });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.deepEqual(cancelled.json(), { stopped: false });
  const socket = await f.connect();
  const accepted = await subscribe(socket, "planning");
  assert.equal(accepted.ok, true);
  assert.equal(accepted.state.id, "planning");
  for (const id of ["headless", "unknown"]) {
    const denied = await subscribe(socket, id);
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 403);
  }
  const wrongSurface = await subscribe(socket, "notes", { hostSurfaceId: "admin" });
  assert.equal(wrongSurface.ok, false);
  assert.equal(wrongSurface.status, 403);
  assert.ok((await f.stored()).every(record => record.turns.length === 0));
});

test("voice example shares one socket across five subscriptions and keeps it usable after an unsubscribe", options, async t => {
  const f = await fixture(t);
  const socket = await f.connect();
  const socketId = socket.id;
  const subscriptions = [];
  for (const id of ids) subscriptions.push(await subscribe(socket, id));
  assert.equal(f.connections(), 1);
  assert.equal(socket.id, socketId);
  assert.ok(subscriptions.every(response => response.ok === true));
  assert.deepEqual(subscriptions.map(response => response.state.id), ids);
  assert.equal(new Set(subscriptions.map(response => response.subscriptionId)).size, 5);
  assert.equal(new Set(subscriptions.map(response => response.streamEpoch)).size, 5);
  assert.deepEqual(await command(socket, "assistant.conversation.unsubscribe", { subscriptionId: "view-planning" }), { ok: true });
  assert.equal(socket.connected, true);
  assert.equal(socket.id, socketId);
  const notes = await subscribe(socket, "notes");
  assert.equal(notes.ok, true);
  assert.equal(notes.state.id, "notes");
  const inspection = await f.app.inject({ method: "POST", url: `${base("notes")}/deliveries/never-sent/inspect`,
    headers: { origin, "x-jskit-surface": "home" } });
  assert.equal(inspection.statusCode, 200, inspection.body);
  assert.deepEqual(inspection.json(), { status: "unknown", messageId: "never-sent" });
  assert.equal(f.connections(), 1, "HTTP injection and five subscriptions do not create another realtime connection");
  for (const id of ids.slice(1)) assert.deepEqual(await command(socket, "assistant.conversation.unsubscribe", { subscriptionId: `view-${id}` }), { ok: true });
  assert.equal(socket.connected, true);
  assert.ok((await f.stored()).every(record => record.turns.length === 0));
});
