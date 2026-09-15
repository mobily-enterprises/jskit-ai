import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { WebSocketServer } from "ws";
import { CodexAppServerJsonRpcClient } from "../src/server/conversation/codexClient.js";

test("unexpected WebSocket closure reports observation loss; explicit close does not", async () => {
  const server = new WebSocketServer({ port: 0 });
  const connected = new Promise((resolve) => server.once("connection", resolve));
  const lost = Promise.withResolvers();
  const errors = [];
  const client = new CodexAppServerJsonRpcClient({
    endpoint: `ws://127.0.0.1:${server.address().port}`,
    onDisconnect(error) { errors.push(error); lost.resolve(); }
  });
  try {
    await client.connect();
    (await connected).terminate();
    await lost.promise;
    assert.equal(client.isOpen(), false);
    assert.equal(errors.length, 1);
    await client.connect();
    client.close();
    assert.equal(errors.length, 1);
  } finally {
    client.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
});

class Socket extends EventEmitter {
  constructor() { super(); queueMicrotask(() => this.emit("open")); }
  close() { this.emit("close"); }
  send() {}
}

test("obsolete socket messages, errors and closure cannot affect its replacement", async () => {
  const errors = [];
  const notifications = [];
  const client = new CodexAppServerJsonRpcClient({
    endpoint: "ws://fixture", WebSocketImpl: Socket, onDisconnect: (error) => errors.push(error)
  });
  try {
    await client.connect();
    const old = client.socket;
    client.close();
    await client.connect();
    client.subscribe((event) => notifications.push(event));
    const pending = client.request("read");
    old.emit("message", JSON.stringify({ id: 1, result: "obsolete" }));
    old.emit("message", JSON.stringify({ method: "obsolete" }));
    old.emit("error", new Error("obsolete"));
    old.emit("close");
    client.socket.emit("message", JSON.stringify({ id: 1, result: "current" }));
    assert.equal(await pending, "current");
    assert.deepEqual(notifications, []);
    assert.deepEqual(errors, []);
  } finally { client.close(); }
});

for (const message of ["invalid JSON", "null"]) test(`unreadable output (${message}) disconnects instead of silently losing observation`, async () => {
  const errors = [];
  const client = new CodexAppServerJsonRpcClient({
    endpoint: "ws://fixture", WebSocketImpl: Socket, onDisconnect: (error) => errors.push(error)
  });
  await client.connect();
  client.socket.emit("message", message);
  assert.equal(errors.length, 1);
  assert.equal(client.isOpen(), false);
});

 test("closing during connection rejects readiness instead of leaving it pending", async () => {
  class PendingSocket extends EventEmitter {
    close() { this.emit("close"); }
  }
  const client = new CodexAppServerJsonRpcClient({ endpoint: "ws://fixture", WebSocketImpl: PendingSocket });
  const connected = client.connect();
  client.close();
  await assert.rejects(connected, /closed before it opened/);
  assert.equal(client.isOpen(), false);
});

test("transport failure preserves its error code for pending requests", async () => {
  const client = new CodexAppServerJsonRpcClient({ endpoint: "ws://fixture", WebSocketImpl: Socket, maxMessageBytes: 100 });
  await client.connect();
  const result = client.request("read");
  client.socket.emit("message", "x".repeat(101));
  await assert.rejects(result, { code: "assistant_codex_app_server_message_too_large" });
  assert.equal(client.isOpen(), false);
});
