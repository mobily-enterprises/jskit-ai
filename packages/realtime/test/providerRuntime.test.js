import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";

import { RealtimeServiceProvider } from "../src/server/RealtimeServiceProvider.js";
import { RealtimeClientProvider } from "../src/client/RealtimeClientProvider.js";
import {
  REALTIME_RUNTIME_SERVER_TOKEN,
  REALTIME_SOCKET_IO_SERVER_TOKEN
} from "../src/server/tokens.js";
import { REALTIME_RUNTIME_CLIENT_TOKEN } from "../src/client/tokens.js";

function createSingletonApp() {
  const instances = new Map();
  const singletons = new Map();
  return {
    instances,
    singletons,
    singleton(token, factory) {
      singletons.set(token, factory);
    },
    instance(token, value) {
      instances.set(token, value);
    },
    has(token) {
      return instances.has(token) || singletons.has(token);
    },
    make(token) {
      if (instances.has(token)) {
        return instances.get(token);
      }
      if (!singletons.has(token)) {
        throw new Error(`Missing token: ${String(token)}`);
      }
      const resolved = singletons.get(token)(this);
      instances.set(token, resolved);
      return resolved;
    }
  };
}

test("RealtimeServiceProvider registers runtime realtime server api", () => {
  const app = createSingletonApp();
  app.instance(KERNEL_TOKENS.Fastify, {
    server: createServer()
  });
  const provider = new RealtimeServiceProvider();
  provider.register(app);

  assert.equal(app.singletons.has(REALTIME_RUNTIME_SERVER_TOKEN), true);
  assert.equal(app.singletons.has(REALTIME_SOCKET_IO_SERVER_TOKEN), true);

  const api = app.make(REALTIME_RUNTIME_SERVER_TOKEN);
  assert.equal(typeof api.createSocketIoServer, "function");
  assert.equal(typeof api.closeSocketIoServer, "function");
});

test("RealtimeServiceProvider boot starts socket io and shutdown closes it", async () => {
  const app = createSingletonApp();
  app.instance(KERNEL_TOKENS.Fastify, {
    server: createServer()
  });

  const provider = new RealtimeServiceProvider();
  provider.register(app);
  provider.boot(app);

  const io = app.make(REALTIME_SOCKET_IO_SERVER_TOKEN);
  assert.equal(Boolean(io), true);
  assert.equal(typeof io.on, "function");

  await provider.shutdown(app);
});

test("RealtimeClientProvider registers runtime realtime client api", () => {
  const app = createSingletonApp();
  const provider = new RealtimeClientProvider();
  provider.register(app);

  assert.equal(app.singletons.has(REALTIME_RUNTIME_CLIENT_TOKEN), true);
  const api = app.make(REALTIME_RUNTIME_CLIENT_TOKEN);
  assert.equal(typeof api.createSocketIoClient, "function");
  assert.equal(typeof api.disconnectSocketIoClient, "function");
});
