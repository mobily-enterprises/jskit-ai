import assert from "node:assert/strict";
import test from "node:test";

import * as serverApi from "../src/server/RealtimeServiceProvider.js";
import * as serverRuntimeApi from "../src/server/runtime.js";
import * as clientApi from "../src/client/RealtimeClientProvider.js";
import * as clientRuntimeApi from "../src/client/runtime.js";
import * as clientListenerApi from "../src/client/listeners.js";
import * as serverTokens from "../src/server/tokens.js";
import * as clientTokens from "../src/client/tokens.js";

test("server entrypoint exports provider only", () => {
  assert.equal(typeof serverApi.RealtimeServiceProvider, "function");
  assert.deepEqual(Object.keys(serverApi).sort(), ["RealtimeServiceProvider"]);
});

test("client entrypoint exports provider only", () => {
  assert.equal(typeof clientApi.RealtimeClientProvider, "function");
  assert.deepEqual(Object.keys(clientApi).sort(), ["RealtimeClientProvider"]);
});

test("token entrypoints export runtime token constants", () => {
  assert.equal(serverTokens.REALTIME_RUNTIME_SERVER_TOKEN, "runtime.realtime");
  assert.equal(serverTokens.REALTIME_SOCKET_IO_SERVER_TOKEN, "runtime.realtime.io");
  assert.equal(clientTokens.REALTIME_RUNTIME_CLIENT_TOKEN, "runtime.realtime.client");
  assert.equal(clientTokens.REALTIME_SOCKET_CLIENT_TOKEN, "runtime.realtime.client.socket");
  assert.equal(typeof clientTokens.REALTIME_CLIENT_LISTENER_TAG, "symbol");
});

test("server runtime entrypoint exports server-only helpers", () => {
  assert.equal(typeof serverRuntimeApi.createSocketIoServer, "function");
  assert.equal(typeof serverRuntimeApi.closeSocketIoServer, "function");
});

test("client runtime entrypoint exports client-only helpers", () => {
  assert.equal(typeof clientRuntimeApi.createSocketIoClient, "function");
  assert.equal(typeof clientRuntimeApi.disconnectSocketIoClient, "function");
});

test("client listeners entrypoint exports realtime listener registration helpers", () => {
  assert.equal(typeof clientListenerApi.registerRealtimeClientListener, "function");
  assert.equal(typeof clientListenerApi.resolveRealtimeClientListeners, "function");
  assert.equal(typeof clientListenerApi.normalizeRealtimeClientListener, "function");
});
