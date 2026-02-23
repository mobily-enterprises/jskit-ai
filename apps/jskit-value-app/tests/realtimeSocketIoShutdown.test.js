import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";
import { Adapter } from "socket.io-adapter";
import { registerSocketIoRealtime, __testables } from "../server/realtime/registerSocketIoRealtime.js";

function createAuthService() {
  return {
    async authenticateRequest() {
      return {
        authenticated: true,
        profile: {
          id: 7,
          email: "user@example.com"
        },
        transientFailure: false
      };
    }
  };
}

function createWorkspaceService() {
  return {
    async resolveRequestContext() {
      return {
        workspace: {
          id: 11,
          slug: "acme"
        },
        permissions: ["projects.read"]
      };
    }
  };
}

test("realtime redis close helper normalizes quit timeout bounds", () => {
  assert.equal(__testables.normalizeRedisQuitTimeoutMs(0, 900), 900);
  assert.equal(__testables.normalizeRedisQuitTimeoutMs(50, 900), 50);
  assert.equal(__testables.normalizeRedisQuitTimeoutMs(1200, 900), 1200);
  assert.equal(__testables.normalizeRedisQuitTimeoutMs(90_000, 900), 60_000);
  assert.equal(__testables.normalizeRedisConnectTimeoutMs(0, 900), 900);
  assert.equal(__testables.normalizeRedisConnectTimeoutMs(50, 900), 50);
  assert.equal(__testables.normalizeRedisConnectTimeoutMs(1200, 900), 1200);
  assert.equal(__testables.normalizeRedisConnectTimeoutMs(90_000, 900), 60_000);
});

test("realtime redis close helper falls back to disconnect when quit stalls", async () => {
  let disconnectCalls = 0;
  const redisClient = {
    isOpen: true,
    async quit() {
      return new Promise(() => {});
    },
    disconnect() {
      disconnectCalls += 1;
      this.isOpen = false;
    }
  };

  const startedAtMs = Date.now();
  await __testables.closeRedisClientWithTimeout(redisClient, { timeoutMs: 25 });
  const elapsedMs = Date.now() - startedAtMs;

  assert.equal(disconnectCalls, 1);
  assert.ok(elapsedMs < 250);
});

test("realtime onClose forces redis disconnect when quit stalls", async () => {
  const app = Fastify();
  let quitCalls = 0;
  let disconnectCalls = 0;
  const redisClient = {
    isOpen: true,
    on() {},
    async connect() {},
    async quit() {
      quitCalls += 1;
      return new Promise(() => {});
    },
    disconnect() {
      disconnectCalls += 1;
      this.isOpen = false;
    }
  };

  class FakeAdapter extends Adapter {
    constructor(namespace) {
      super(namespace);
    }

    init() {}
  }

  await registerSocketIoRealtime(app, {
    authService: createAuthService(),
    realtimeEventsService: {
      subscribe() {
        return () => {};
      }
    },
    workspaceService: createWorkspaceService(),
    redisUrl: "redis://example.invalid:6379",
    redisQuitTimeoutMs: 25,
    redisClientFactory: () => redisClient,
    redisStreamsAdapterFactory: () => FakeAdapter
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  await app.close();

  assert.equal(quitCalls, 1);
  assert.equal(disconnectCalls, 1);
});

test("realtime registration falls back to in-memory mode when Redis connect times out and adapter is optional", async () => {
  const app = Fastify();
  const logs = [];
  let disconnectCalls = 0;
  const redisClient = {
    isOpen: true,
    on() {},
    async connect() {
      return new Promise(() => {});
    },
    disconnect() {
      disconnectCalls += 1;
      this.isOpen = false;
    }
  };

  const startedAtMs = Date.now();
  await registerSocketIoRealtime(app, {
    authService: createAuthService(),
    realtimeEventsService: {
      subscribe() {
        return () => {};
      }
    },
    workspaceService: createWorkspaceService(),
    redisUrl: "redis://example.invalid:6379",
    redisConnectTimeoutMs: 20,
    redisQuitTimeoutMs: 20,
    logger: {
      info(_payload, message) {
        logs.push(String(message || ""));
      },
      warn(_payload, message) {
        logs.push(String(message || ""));
      }
    },
    redisClientFactory: () => redisClient
  });
  const elapsedMs = Date.now() - startedAtMs;

  assert.ok(elapsedMs < 300);
  assert.equal(disconnectCalls, 1);
  assert.equal(logs.includes("realtime.socketio.redis_unavailable_falling_back_to_memory"), true);
  assert.equal(logs.includes("realtime.socketio.started_without_redis"), true);

  await app.listen({ host: "127.0.0.1", port: 0 });
  await app.close();
});

test("realtime registration fails fast when Redis adapter is required and connect times out", async () => {
  const app = Fastify();
  let disconnectCalls = 0;
  const redisClient = {
    isOpen: true,
    on() {},
    async connect() {
      return new Promise(() => {});
    },
    disconnect() {
      disconnectCalls += 1;
      this.isOpen = false;
    }
  };

  const startedAtMs = Date.now();
  await assert.rejects(
    () =>
      registerSocketIoRealtime(app, {
        authService: createAuthService(),
        realtimeEventsService: {
          subscribe() {
            return () => {};
          }
        },
        workspaceService: createWorkspaceService(),
        redisUrl: "redis://example.invalid:6379",
        requireRedisAdapter: true,
        redisConnectTimeoutMs: 20,
        redisQuitTimeoutMs: 20,
        redisClientFactory: () => redisClient
      }),
    /Failed to connect Redis Streams adapter/
  );
  const elapsedMs = Date.now() - startedAtMs;

  assert.ok(elapsedMs < 300);
  assert.equal(disconnectCalls, 1);
  await app.close();
});
