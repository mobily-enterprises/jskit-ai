import assert from "node:assert/strict";
import test from "node:test";

import { createSocketIoClient, disconnectSocketIoClient } from "../src/client/runtime.js";

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
