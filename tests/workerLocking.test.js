import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireDistributedLock,
  releaseDistributedLock,
  extendDistributedLock,
  __testables
} from "../server/workers/locking.js";

test("worker locking helpers normalize lock primitives", () => {
  assert.equal(__testables.normalizeLockTtlMs(500, 9000), 1000);
  assert.equal(__testables.normalizeLockTtlMs(4000, 9000), 4000);
  assert.equal(__testables.normalizeLockTtlMs(999999999, 9000), 24 * 60 * 60 * 1000);
  assert.equal(__testables.normalizeLockTtlMs(0, 9000), 9000);
  assert.equal(__testables.normalizeLockKey("  lock:key "), "lock:key");
  assert.equal(__testables.normalizeLockToken("  token "), "token");
});

test("acquireDistributedLock uses SET NX PX semantics", async () => {
  const calls = [];
  const connection = {
    async set(...args) {
      calls.push(args);
      return "OK";
    }
  };

  const acquired = await acquireDistributedLock({
    connection,
    key: "lock:test",
    token: "token_1",
    ttlMs: 12000
  });

  assert.equal(acquired, true);
  assert.deepEqual(calls[0], ["lock:test", "token_1", "PX", 12000, "NX"]);
});

test("releaseDistributedLock uses compare-and-delete Lua script", async () => {
  const calls = [];
  const connection = {
    async eval(script, keyCount, key, token) {
      calls.push({ script, keyCount, key, token });
      return 1;
    }
  };

  const released = await releaseDistributedLock({
    connection,
    key: "lock:test",
    token: "token_1"
  });

  assert.equal(released, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].keyCount, 1);
  assert.equal(calls[0].key, "lock:test");
  assert.equal(calls[0].token, "token_1");
});

test("extendDistributedLock refreshes ttl only for matching lock token", async () => {
  const calls = [];
  const connection = {
    async eval(script, keyCount, key, token, ttlMs) {
      calls.push({ script, keyCount, key, token, ttlMs });
      return 1;
    }
  };

  const extended = await extendDistributedLock({
    connection,
    key: "lock:test",
    token: "token_1",
    ttlMs: 12_000
  });

  assert.equal(extended, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].keyCount, 1);
  assert.equal(calls[0].key, "lock:test");
  assert.equal(calls[0].token, "token_1");
  assert.equal(calls[0].ttlMs, 12_000);
  assert.equal(calls[0].script.includes("pexpire"), true);
});
