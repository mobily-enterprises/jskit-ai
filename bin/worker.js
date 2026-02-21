#!/usr/bin/env node

import { env } from "../server/lib/env.js";
import { createWorkerRuntime } from "../server/workers/runtime.js";

const runtime = createWorkerRuntime({
  redisUrl: env.REDIS_URL,
  workerConcurrency: env.WORKER_CONCURRENCY,
  lockHeldRequeueMax: env.WORKER_LOCK_HELD_REQUEUE_MAX,
  retentionLockTtlMs: env.WORKER_RETENTION_LOCK_TTL_MS,
  retentionConfig: {
    errorLogRetentionDays: env.ERROR_LOG_RETENTION_DAYS,
    inviteArtifactRetentionDays: env.INVITE_ARTIFACT_RETENTION_DAYS,
    securityAuditRetentionDays: env.SECURITY_AUDIT_RETENTION_DAYS,
    aiTranscriptsRetentionDays: env.AI_TRANSCRIPTS_RETENTION_DAYS,
    billingIdempotencyRetentionDays: env.BILLING_IDEMPOTENCY_RETENTION_DAYS,
    billingWebhookPayloadRetentionDays: env.BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS,
    batchSize: env.RETENTION_BATCH_SIZE
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
