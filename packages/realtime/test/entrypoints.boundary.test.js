import assert from "node:assert/strict";
import test from "node:test";

import * as serverApi from "../src/server/RealtimeServiceProvider.js";
import * as serverRuntimeApi from "../src/server/runtime.js";
import * as clientApi from "../src/client/RealtimeClientProvider.js";
import * as clientRuntimeApi from "../src/client/runtime.js";
import * as clientListenerApi from "../src/client/listeners.js";

test("server entrypoint exports provider only", () => {
  assert.equal(typeof serverApi.RealtimeServiceProvider, "function");
  assert.deepEqual(Object.keys(serverApi).sort(), ["RealtimeServiceProvider"]);
});

test("client entrypoint exports provider only", () => {
  assert.equal(typeof clientApi.RealtimeClientProvider, "function");
  assert.deepEqual(Object.keys(clientApi).sort(), ["RealtimeClientProvider"]);
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
