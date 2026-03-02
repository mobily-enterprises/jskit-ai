import assert from "node:assert/strict";
import test from "node:test";

import { createRetentionSweepLockKey } from "../src/server/workerConstants.js";
import {
  __testables,
  createRetentionSweepProcessor,
  isRetentionLockHeldError
} from "../src/server/retentionProcessor.js";

const REDIS_NAMESPACE = "jskit:ops:test";

test("retention processor acquires lock, runs sweep, and emits normalized payload metadata", async () => {
  const calls = {
    runSweep: [],
    lockAcquire: [],
    lockRelease: []
  };

  const processor = createRetentionSweepProcessor({
    logger: null,
    redisNamespace: REDIS_NAMESPACE,
    lockConnection: { id: "redis_lock" },
    lockTtlMs: 12_000,
    acquireDistributedLockImpl: async (payload) => {
      calls.lockAcquire.push(payload);
      return true;
    },
    extendDistributedLockImpl: async () => true,
    releaseDistributedLockImpl: async (payload) => {
      calls.lockRelease.push(payload);
      return true;
    },
    runSweep: async (payload) => {
      calls.runSweep.push(payload);
      return {
        executedAt: "2026-02-21T00:00:00.000Z",
        dryRun: payload.dryRun,
        totalDeletedRows: payload.dryRun ? 0 : 8,
        rules: []
      };
    }
  });

  const result = await processor({
    id: "job_123",
    data: {
      dryRun: true,
      trigger: "cron",
      requestedBy: "systemd"
    }
  });

  assert.equal(calls.runSweep.length, 1);
  assert.equal(calls.runSweep[0].dryRun, true);
  assert.equal(calls.lockAcquire.length, 1);
  assert.equal(calls.lockAcquire[0].key, createRetentionSweepLockKey(REDIS_NAMESPACE));
  assert.equal(calls.lockAcquire[0].ttlMs, 12_000);
  assert.equal(calls.lockRelease.length, 1);
  assert.equal(result.trigger, "cron");
  assert.equal(result.requestedBy, "systemd");
});

test("retention processor throws lock-held error when distributed lock is unavailable", async () => {
  const processor = createRetentionSweepProcessor({
    logger: null,
    redisNamespace: REDIS_NAMESPACE,
    lockConnection: { id: "redis_lock" },
    acquireDistributedLockImpl: async () => false,
    runSweep: async () => ({ totalDeletedRows: 0, rules: [] })
  });

  await assert.rejects(
    () =>
      processor({
        id: "job_locked",
        data: {
          dryRun: false,
          trigger: "manual",
          requestedBy: "operator"
        }
      }),
    (error) => {
      assert.equal(isRetentionLockHeldError(error), true);
      assert.equal(error.code, "RETENTION_LOCK_HELD");
      assert.equal(error.jobId, "job_locked");
      return true;
    }
  );
});

test("retention processor testables expose heartbeat interval and lock-held classifier", () => {
  assert.equal(__testables.normalizeLockHeartbeatIntervalMs(500), 333);
  assert.equal(
    __testables.isRetentionLockHeldError({
      code: "RETENTION_LOCK_HELD"
    }),
    true
  );
});
