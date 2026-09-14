import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { Server } from "socket.io";

import { createSocketIoClient, disconnectSocketIoClient } from "../src/client/runtime.js";
import { attachSocketConnectionRecovery } from "../src/client/connectionRecovery.js";

test("createSocketIoClient calls connect with fixed socket path", () => {
  const calls = [];
  const socket = {
    id: "socket-1"
  };
  const connect = (...args) => {
    calls.push(args);
    return socket;
  };

  const created = createSocketIoClient({
    url: " https://example.com ",
    options: {
      path: "realtime",
      withCredentials: true
    },
    connect
  });

  assert.equal(created, socket);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "https://example.com",
    {
      path: "/socket.io",
      withCredentials: true
    }
  ]);
});

test("createSocketIoClient supports url-less connection with fixed socket path", () => {
  const calls = [];
  const connect = (...args) => {
    calls.push(args);
    return {
      id: "socket-2"
    };
  };

  createSocketIoClient({
    options: {
      path: "ws"
    },
    connect
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    {
      path: "/socket.io"
    }
  ]);
});

test("createSocketIoClient rejects invalid connect function", () => {
  assert.throws(
    () => createSocketIoClient({ connect: null }),
    /requires a valid socket\.io client connect function/
  );
});

test("disconnectSocketIoClient calls socket.disconnect when available", () => {
  let disconnected = false;
  disconnectSocketIoClient({
    disconnect() {
      disconnected = true;
    }
  });
  assert.equal(disconnected, true);
});

test("disconnectSocketIoClient is a no-op for missing socket", () => {
  disconnectSocketIoClient(null);
  disconnectSocketIoClient({});
  assert.equal(true, true);
});

function recoverySocket(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const socket = Object.assign(new EventEmitter(), {
    active: false,
    connected: false,
    connect: t.mock.fn(),
    io: { reconnection: () => true }
  });
  const detach = attachSocketConnectionRecovery(socket);
  t.after(detach);
  return { socket, detach };
}

test("server disconnect recovery backs off middleware rejection and resets after connection", (t) => {
  const { socket } = recoverySocket(t);
  socket.emit("disconnect", "io server disconnect");
  for (const [index, delay] of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000].entries()) {
    t.mock.timers.tick(delay - 1);
    assert.equal(socket.connect.mock.callCount(), index);
    t.mock.timers.tick(1);
    assert.equal(socket.connect.mock.callCount(), index + 1);
    socket.emit("connect_error", new Error("Authentication required"));
  }
  socket.connected = true;
  socket.emit("connect");
  t.mock.timers.tick(30_000);
  assert.equal(socket.connect.mock.callCount(), 7);
  socket.connected = false;
  socket.emit("disconnect", "io server disconnect");
  t.mock.timers.tick(1_000);
  assert.equal(socket.connect.mock.callCount(), 8);
});

test("recovery leaves transport retries and intentional disconnects to Socket.IO", (t) => {
  const { socket, detach } = recoverySocket(t);
  socket.active = true;
  socket.emit("disconnect", "transport close");
  socket.emit("connect_error", new Error("Temporary transport error"));
  t.mock.timers.tick(30_000);
  assert.equal(socket.connect.mock.callCount(), 0);
  socket.active = false;
  socket.emit("disconnect", "io server disconnect");
  socket.emit("disconnect", "io client disconnect");
  t.mock.timers.tick(30_000);
  assert.equal(socket.connect.mock.callCount(), 0);
  socket.emit("disconnect", "io server disconnect");
  detach();
  t.mock.timers.tick(30_000);
  assert.equal(socket.connect.mock.callCount(), 0);
  assert.equal(socket.eventNames().length, 0);
});

test("recovery respects reconnection disabled at startup or while a retry is pending", (t) => {
  const { socket } = recoverySocket(t);
  const client = createSocketIoClient({ options: { autoConnect: false, reconnection: false } });
  socket.io = client.io;
  t.after(() => client.disconnect());
  socket.emit("disconnect", "io server disconnect");
  socket.emit("connect_error", new Error("Rejected"));
  t.mock.timers.tick(30_000);
  assert.equal(socket.connect.mock.callCount(), 0);
  socket.io.reconnection(true);
  socket.emit("connect_error", new Error("Rejected"));
  socket.io.reconnection(false);
  t.mock.timers.tick(30_000);
  assert.equal(socket.connect.mock.callCount(), 0);
});

test("hidden or offline pages resume recovery when available and remove their listeners on teardown", (t) => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const document = Object.assign(new EventTarget(), { hidden: true });
  const window = Object.assign(new EventTarget(), { navigator: { onLine: true } });
  globalThis.document = document;
  globalThis.window = window;
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const { socket, detach } = recoverySocket(t);
  socket.emit("disconnect", "io server disconnect");
  t.mock.timers.tick(30_000);
  assert.equal(socket.connect.mock.callCount(), 0);
  document.hidden = false;
  window.navigator.onLine = false;
  document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(socket.connect.mock.callCount(), 0);
  window.navigator.onLine = true;
  window.dispatchEvent(new Event("online"));
  assert.equal(socket.connect.mock.callCount(), 1);
  socket.emit("connect_error", new Error("Temporary failure"));
  detach();
  window.dispatchEvent(new Event("online"));
  document.dispatchEvent(new Event("visibilitychange"));
  t.mock.timers.tick(30_000);
  assert.equal(socket.connect.mock.callCount(), 1);
});

test("a real server-forced disconnect reconnects through a fresh authenticated handshake", async (t) => {
  const http = createServer();
  const io = new Server(http);
  let handshakes = 0;
  io.use((_socket, next) => {
    handshakes += 1;
    if (handshakes === 2) return next(new Error("Temporary authentication lookup failure"));
    next();
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const client = createSocketIoClient({ url: `http://127.0.0.1:${http.address().port}` });
  const detach = attachSocketConnectionRecovery(client);
  t.after(async () => {
    detach();
    client.disconnect();
    await new Promise((resolve) => io.close(resolve));
  });
  await once(client, "connect", { signal: AbortSignal.timeout(5_000) });
  const before = client.id;
  const disconnected = once(client, "disconnect");
  io.sockets.sockets.get(before).disconnect(true);
  assert.equal((await disconnected)[0], "io server disconnect");
  assert.equal(client.active, false);
  await once(client, "connect", { signal: AbortSignal.timeout(8_000) });
  assert.equal(handshakes, 3);
  assert.notEqual(client.id, before);
});
