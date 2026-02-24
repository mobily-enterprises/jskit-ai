import assert from "node:assert/strict";
import test from "node:test";

import { createRetentionSweepLockKey } from "@jskit-ai/redis-ops-core/workerConstants";
import { createRetentionSweepProcessor, __testables } from "../server/workers/retentionProcessor.js";

const REDIS_NAMESPACE = "jskit:value-app:test";

test("retention sweep processor normalizes policy and delegates to retention service", async () => {
  const calls = {
    serviceArgs: null,
    sweepCalls: [],
    coreArgs: null
  };

  const processor = createRetentionSweepProcessor({
    logger: null,
    redisNamespace: REDIS_NAMESPACE,
    retentionConfig: {
      errorLogRetentionDays: "45",
      inviteArtifactRetentionDays: "120",
      securityAuditRetentionDays: "500",
      aiTranscriptsRetentionDays: "30",
      chatMessagesRetentionDays: "450",
      chatAttachmentsRetentionDays: "540",
      chatUnattachedUploadsRetentionHours: "48",
      chatMessageIdempotencyRetryWindowHours: "96",
      chatEmptyThreadCleanupEnabled: "true",
      batchSize: "2500"
    },
    createRepositoriesImpl: () => ({
      consoleErrorLogsRepository: {},
      workspaceInvitesRepository: {},
      consoleInvitesRepository: {},
      auditEventsRepository: {},
      aiTranscriptConversationsRepository: {},
      aiTranscriptMessagesRepository: {},
      chatThreadsRepository: {},
      chatParticipantsRepository: {},
      chatMessagesRepository: {},
      chatIdempotencyTombstonesRepository: {},
      chatAttachmentsRepository: {}
    }),
    createRetentionServiceImpl: (args) => {
      calls.serviceArgs = args;
      return {
        async runSweep(params) {
          calls.sweepCalls.push(params);
          return {
            executedAt: "2026-02-21T00:00:00.000Z",
            dryRun: params.dryRun,
            totalDeletedRows: params.dryRun ? 0 : 42,
            rules: []
          };
        }
      };
    },
    createRetentionSweepProcessorImpl: (args) => {
      calls.coreArgs = args;
      return async (job) =>
        args.runSweep({
          dryRun: Boolean(job?.data?.dryRun),
          logger: args.logger,
          payload: {
            trigger: "manual",
            requestedBy: "test",
            idempotencyKey: "abc"
          },
          job
        });
    }
  });

  const result = await processor({
    id: "job_123",
    data: {
      dryRun: true
    }
  });

  assert.equal(calls.serviceArgs.retentionConfig.errorLogRetentionDays, 45);
  assert.equal(calls.serviceArgs.retentionConfig.inviteArtifactRetentionDays, 120);
  assert.equal(calls.serviceArgs.retentionConfig.securityAuditRetentionDays, 500);
  assert.equal(calls.serviceArgs.retentionConfig.aiTranscriptsRetentionDays, 30);
  assert.equal(calls.serviceArgs.retentionConfig.chatMessagesRetentionDays, 450);
  assert.equal(calls.serviceArgs.retentionConfig.chatAttachmentsRetentionDays, 540);
  assert.equal(calls.serviceArgs.retentionConfig.chatUnattachedUploadsRetentionHours, 48);
  assert.equal(calls.serviceArgs.retentionConfig.chatMessageIdempotencyRetryWindowHours, 96);
  assert.equal(calls.serviceArgs.retentionConfig.chatEmptyThreadCleanupEnabled, true);
  assert.equal(calls.serviceArgs.retentionConfig.batchSize, 2500);
  assert.equal(calls.sweepCalls.length, 1);
  assert.equal(calls.sweepCalls[0].dryRun, true);
  assert.equal(calls.coreArgs.redisNamespace, REDIS_NAMESPACE);
  assert.equal(calls.coreArgs.lockTtlMs, 30 * 60 * 1000);
  assert.equal(result.totalDeletedRows, 0);
});

test("retention processor throws retryable lock-held error when distributed lock is already held", async () => {
  const processor = createRetentionSweepProcessor({
    logger: null,
    redisNamespace: REDIS_NAMESPACE,
    retentionConfig: {},
    lockConnection: { id: "redis_lock" },
    acquireDistributedLockImpl: async () => false,
    createRepositoriesImpl: () => ({
      consoleErrorLogsRepository: {},
      workspaceInvitesRepository: {},
      consoleInvitesRepository: {},
      auditEventsRepository: {},
      aiTranscriptConversationsRepository: {},
      aiTranscriptMessagesRepository: {},
      chatThreadsRepository: {},
      chatParticipantsRepository: {},
      chatMessagesRepository: {},
      chatIdempotencyTombstonesRepository: {},
      chatAttachmentsRepository: {}
    }),
    createRetentionServiceImpl: () => ({
      async runSweep() {
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
      assert.equal(__testables.isRetentionLockHeldError(error), true);
      assert.equal(error.code, "RETENTION_LOCK_HELD");
      assert.equal(error.jobId, "job_999");
      return true;
    }
  );
});

test("retention processor testables expose lock heartbeat helper", () => {
  assert.equal(__testables.normalizeLockHeartbeatIntervalMs(500), 333);
  const lockKey = createRetentionSweepLockKey(REDIS_NAMESPACE);
  assert.equal(lockKey.startsWith(`${REDIS_NAMESPACE}:`), true);
  assert.equal(lockKey.includes("ops.retention.sweep"), true);
});
