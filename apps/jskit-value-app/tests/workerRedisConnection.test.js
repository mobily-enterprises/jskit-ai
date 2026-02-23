import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkerRedisConnection,
  closeWorkerRedisConnection,
  __testables
} from "../server/workers/redisConnection.js";

test("worker redis connection normalizes URL and validates required redis URL", () => {
  assert.equal(__testables.normalizeRedisUrl("  redis://localhost:6379/1 "), "redis://localhost:6379/1");
  assert.equal(__testables.normalizeRedisUrl(""), "");
  assert.equal(__testables.normalizeWorkerRedisQuitTimeoutMs("invalid"), 3000);
  assert.equal(__testables.normalizeWorkerRedisQuitTimeoutMs(0), 3000);
  assert.equal(__testables.normalizeWorkerRedisQuitTimeoutMs(65_000), 60_000);
  assert.equal(__testables.resolveWorkerRedisRetryDelayMs("invalid"), 250);
  assert.equal(__testables.resolveWorkerRedisRetryDelayMs(1), 250);
  assert.equal(__testables.resolveWorkerRedisRetryDelayMs(2), 500);
  assert.equal(__testables.resolveWorkerRedisRetryDelayMs(10), 5000);

  assert.throws(() => createWorkerRedisConnection({ redisUrl: "" }), /REDIS_URL is required/);
});

test("worker redis connection uses provided constructor and close helper prefers quit", async () => {
  const captured = {
    url: "",
    options: null,
    quitCalls: 0,
    disconnectCalls: 0
  };

  class FakeConnection {
    constructor(url, options) {
      captured.url = url;
      captured.options = options;
    }

    async quit() {
      captured.quitCalls += 1;
    }

    disconnect() {
      captured.disconnectCalls += 1;
    }
  }

  const connection = createWorkerRedisConnection({
    redisUrl: "redis://localhost:6379",
    connectionCtor: FakeConnection
  });

  assert.equal(captured.url, "redis://localhost:6379");
  assert.equal(captured.options.maxRetriesPerRequest, null);
  assert.equal(captured.options.enableReadyCheck, false);
  assert.equal(captured.options.connectTimeout, 5000);
  assert.equal(typeof captured.options.retryStrategy, "function");
  assert.equal(captured.options.retryStrategy(1), 250);
  assert.equal(captured.options.retryStrategy(8), 5000);

  await closeWorkerRedisConnection(connection);
  assert.equal(captured.quitCalls, 1);
  assert.equal(captured.disconnectCalls, 0);
});

test("worker redis close helper falls back to disconnect when quit fails", async () => {
  const captured = {
    quitCalls: 0,
    disconnectCalls: 0
  };

  const connection = {
    async quit() {
      captured.quitCalls += 1;
      throw new Error("quit failed");
    },
    disconnect() {
      captured.disconnectCalls += 1;
    }
  };

  await closeWorkerRedisConnection(connection);
  assert.equal(captured.quitCalls, 1);
  assert.equal(captured.disconnectCalls, 1);
});

test("worker redis close helper falls back to disconnect when quit stalls", async () => {
  const captured = {
    quitCalls: 0,
    disconnectCalls: 0
  };

  const connection = {
    async quit() {
      captured.quitCalls += 1;
      return new Promise(() => {});
    },
    disconnect() {
      captured.disconnectCalls += 1;
    }
  };

  await closeWorkerRedisConnection(connection, {
    quitTimeoutMs: 10
  });
  assert.equal(captured.quitCalls, 1);
  assert.equal(captured.disconnectCalls, 1);
});
