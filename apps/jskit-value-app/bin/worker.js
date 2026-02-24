#!/usr/bin/env node

import { repositoryConfig } from "../config/index.js";
import { runtimeEnv } from "../server/lib/runtimeEnv.js";
import { createWorkerRuntime } from "../server/workers/runtime.js";

const runtime = createWorkerRuntime({
  redisUrl: runtimeEnv.REDIS_URL,
  redisNamespace: runtimeEnv.REDIS_NAMESPACE,
  workerConcurrency: runtimeEnv.WORKER_CONCURRENCY,
  lockHeldRequeueMax: runtimeEnv.WORKER_LOCK_HELD_REQUEUE_MAX,
  retentionLockTtlMs: runtimeEnv.WORKER_RETENTION_LOCK_TTL_MS,
  retentionConfig: {
    errorLogRetentionDays: repositoryConfig.retention.errorLogDays,
    inviteArtifactRetentionDays: repositoryConfig.retention.inviteArtifactDays,
    securityAuditRetentionDays: repositoryConfig.retention.securityAuditDays,
    aiTranscriptsRetentionDays: repositoryConfig.retention.aiTranscriptsDays,
    billingIdempotencyRetentionDays: repositoryConfig.billing.retention.idempotencyDays,
    billingWebhookPayloadRetentionDays: repositoryConfig.billing.retention.webhookPayloadDays,
    chatMessagesRetentionDays: repositoryConfig.retention.chat.messagesDays,
    chatAttachmentsRetentionDays: repositoryConfig.retention.chat.attachmentsDays,
    chatUnattachedUploadsRetentionHours: repositoryConfig.chat.unattachedUploadRetentionHours,
    chatMessageIdempotencyRetryWindowHours: repositoryConfig.retention.chat.messageIdempotencyRetryWindowHours,
    chatEmptyThreadCleanupEnabled: repositoryConfig.retention.chat.emptyThreadCleanupEnabled,
    batchSize: runtimeEnv.RETENTION_BATCH_SIZE
  },
  logger: console
});

let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  if (signal) {
    console.log(`Received ${signal}. Stopping worker runtime.`);
  }

  try {
    await runtime.stop();
    process.exit(exitCode);
  } catch (error) {
    console.error("Failed to stop worker runtime cleanly:", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT", 0);
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM", 0);
});

try {
  const started = await runtime.start();
  console.log(`Worker runtime started for queue "${started.queue}" with concurrency ${started.concurrency}.`);
} catch (error) {
  console.error("Failed to initialize worker runtime:", error);
  process.exit(1);
}
