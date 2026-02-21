import assert from "node:assert/strict";
import test from "node:test";

import { createRetentionSweepProcessor, __testables } from "../server/workers/retentionProcessor.js";

test("retention sweep processor normalizes retention config and executes runSweep", async () => {
  const calls = {
    serviceArgs: null,
    runSweep: [],
    lockAcquire: [],
    lockRelease: [],
    lockExtend: []
  };

  const processor = createRetentionSweepProcessor({
    logger: null,
    retentionConfig: {
      errorLogRetentionDays: "45",
      inviteArtifactRetentionDays: "120",
      securityAuditRetentionDays: "500",
      aiTranscriptsRetentionDays: "30",
      batchSize: "2500"
    },
    createRepositoriesImpl: () => ({
      consoleErrorLogsRepository: {},
      workspaceInvitesRepository: {},
      consoleInvitesRepository: {},
      auditEventsRepository: {},
      aiTranscriptConversationsRepository: {},
      aiTranscriptMessagesRepository: {}
    }),
    createRetentionServiceImpl: (args) => {
      calls.serviceArgs = args;
      return {
        async runSweep(params) {
          calls.runSweep.push(params);
          return {
            executedAt: "2026-02-21T00:00:00.000Z",
            dryRun: params.dryRun,
            totalDeletedRows: params.dryRun ? 0 : 42,
            rules: []
          };
        }
      };
    },
    lockConnection: { id: "redis_lock" },
    lockKey: "lock:test.retention",
    lockTtlMs: 10000,
    acquireDistributedLockImpl: async (payload) => {
      calls.lockAcquire.push(payload);
      return true;
    },
    extendDistributedLockImpl: async (payload) => {
      calls.lockExtend.push(payload);
      return true;
    },
    releaseDistributedLockImpl: async (payload) => {
      calls.lockRelease.push(payload);
      return true;
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

  assert.equal(calls.serviceArgs.retentionConfig.errorLogRetentionDays, 45);
  assert.equal(calls.serviceArgs.retentionConfig.inviteArtifactRetentionDays, 120);
  assert.equal(calls.serviceArgs.retentionConfig.securityAuditRetentionDays, 500);
  assert.equal(calls.serviceArgs.retentionConfig.aiTranscriptsRetentionDays, 30);
  assert.equal(calls.serviceArgs.retentionConfig.batchSize, 2500);
  assert.equal(calls.runSweep.length, 1);
  assert.equal(calls.runSweep[0].dryRun, true);
  assert.equal(calls.lockAcquire.length, 1);
  assert.equal(calls.lockAcquire[0].key, "lock:test.retention");
  assert.equal(calls.lockAcquire[0].ttlMs, 10000);
  assert.equal(calls.lockRelease.length, 1);
  assert.equal(result.trigger, "cron");
  assert.equal(result.requestedBy, "systemd");
  assert.equal(result.idempotencyKey, "cron-2026-02-21-dry-run");
});

test("retention processor numeric helper falls back for invalid values", () => {
  assert.equal(__testables.toPositiveInteger("5", 9), 5);
  assert.equal(__testables.toPositiveInteger("0", 9), 9);
  assert.equal(__testables.toPositiveInteger("", 9), 9);
  assert.equal(__testables.normalizeLockHeartbeatIntervalMs(500), 333);
});

test("retention processor throws retryable lock-held error when distributed lock is already held", async () => {
  const calls = {
    runSweep: 0
  };

  const processor = createRetentionSweepProcessor({
    logger: null,
    retentionConfig: {},
    lockConnection: { id: "redis_lock" },
    acquireDistributedLockImpl: async () => false,
    extendDistributedLockImpl: async () => true,
    releaseDistributedLockImpl: async () => true,
    createRepositoriesImpl: () => ({
      consoleErrorLogsRepository: {},
      workspaceInvitesRepository: {},
      consoleInvitesRepository: {},
      auditEventsRepository: {},
      aiTranscriptConversationsRepository: {},
      aiTranscriptMessagesRepository: {}
    }),
    createRetentionServiceImpl: () => ({
      async runSweep() {
        calls.runSweep += 1;
        return {
          executedAt: "2026-02-21T00:00:00.000Z",
          dryRun: false,
          totalDeletedRows: 0,
          rules: []
        };
      }
    })
  });

  await assert.rejects(
    () =>
      processor({
        id: "job_999",
        data: {
          dryRun: false,
          trigger: "manual",
          requestedBy: "operator"
        }
      }),
    (error) => {
      assert.equal(calls.runSweep, 0);
      assert.equal(__testables.isRetentionLockHeldError(error), true);
      assert.equal(error.code, "RETENTION_LOCK_HELD");
      assert.equal(error.jobId, "job_999");
      return true;
    }
  );
});

test("retention processor extends lock heartbeat while sweep is running", async () => {
  const calls = {
    lockExtend: 0,
    lockAcquireTtlMs: null,
    lockExtendTtlMs: null
  };

  const processor = createRetentionSweepProcessor({
    logger: null,
    retentionConfig: {},
    lockConnection: { id: "redis_lock" },
    lockTtlMs: 900,
    acquireDistributedLockImpl: async (payload) => {
      calls.lockAcquireTtlMs = payload.ttlMs;
      return true;
    },
    extendDistributedLockImpl: async (payload) => {
      calls.lockExtend += 1;
      calls.lockExtendTtlMs = payload.ttlMs;
      return true;
    },
    releaseDistributedLockImpl: async () => true,
    createRepositoriesImpl: () => ({
      consoleErrorLogsRepository: {},
      workspaceInvitesRepository: {},
      consoleInvitesRepository: {},
      auditEventsRepository: {},
      aiTranscriptConversationsRepository: {},
      aiTranscriptMessagesRepository: {}
    }),
    createRetentionServiceImpl: () => ({
      async runSweep() {
        await new Promise((resolve) => {
          setTimeout(resolve, 750);
        });
        return {
          executedAt: "2026-02-21T00:00:00.000Z",
          dryRun: true,
          totalDeletedRows: 0,
          rules: []
        };
      }
    })
  });

  await processor({
    id: "job_lock_heartbeat",
    data: {
      dryRun: true,
      trigger: "manual",
      requestedBy: "test"
    }
  });

  assert.ok(calls.lockExtend >= 1);
  assert.equal(calls.lockAcquireTtlMs, 1000);
  assert.equal(calls.lockExtendTtlMs, 1000);
});

test("retention processor fails job when lock extension is lost during sweep", async () => {
  let lockExtendCalls = 0;

  const processor = createRetentionSweepProcessor({
    logger: null,
    retentionConfig: {},
    lockConnection: { id: "redis_lock" },
    lockTtlMs: 900,
    acquireDistributedLockImpl: async () => true,
    extendDistributedLockImpl: async () => {
      lockExtendCalls += 1;
      return lockExtendCalls < 2;
    },
    releaseDistributedLockImpl: async () => true,
    createRepositoriesImpl: () => ({
      consoleErrorLogsRepository: {},
      workspaceInvitesRepository: {},
      consoleInvitesRepository: {},
      auditEventsRepository: {},
      aiTranscriptConversationsRepository: {},
      aiTranscriptMessagesRepository: {}
    }),
    createRetentionServiceImpl: () => ({
      async runSweep() {
        await new Promise((resolve) => {
          setTimeout(resolve, 750);
        });
        return {
          executedAt: "2026-02-21T00:00:00.000Z",
          dryRun: true,
          totalDeletedRows: 0,
          rules: []
        };
      }
    })
  });

  await assert.rejects(
    () =>
      processor({
        id: "job_lock_lost",
        data: {
          dryRun: true,
          trigger: "manual",
          requestedBy: "test"
        }
      }),
    /lock extension failed/
  );
});

test("retention processor fails when an in-flight lock heartbeat reports failure after sweep completes", async () => {
  let lockExtendCalls = 0;

  const processor = createRetentionSweepProcessor({
    logger: null,
    retentionConfig: {},
    lockConnection: { id: "redis_lock" },
    lockTtlMs: 900,
    acquireDistributedLockImpl: async () => true,
    extendDistributedLockImpl: async () => {
      lockExtendCalls += 1;
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
      return false;
    },
    releaseDistributedLockImpl: async () => true,
    createRepositoriesImpl: () => ({
      consoleErrorLogsRepository: {},
      workspaceInvitesRepository: {},
      consoleInvitesRepository: {},
      auditEventsRepository: {},
      aiTranscriptConversationsRepository: {},
      aiTranscriptMessagesRepository: {}
    }),
    createRetentionServiceImpl: () => ({
      async runSweep() {
        await new Promise((resolve) => {
          setTimeout(resolve, 350);
        });
        return {
          executedAt: "2026-02-21T00:00:00.000Z",
          dryRun: false,
          totalDeletedRows: 12,
          rules: []
        };
      }
    })
  });

  await assert.rejects(
    () =>
      processor({
        id: "job_lock_late_fail",
        data: {
          dryRun: false,
          trigger: "manual",
          requestedBy: "test"
        }
      }),
    /lock extension failed/
  );
  assert.ok(lockExtendCalls >= 1);
});
