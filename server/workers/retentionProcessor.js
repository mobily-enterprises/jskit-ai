import { randomUUID } from "node:crypto";
import { createService as createRetentionService } from "../domain/operations/services/retention.service.js";
import { createRepositories } from "../runtime/repositories.js";
import { RETENTION_SWEEP_LOCK_KEY } from "./constants.js";
import {
  acquireDistributedLock,
  releaseDistributedLock,
  extendDistributedLock,
  normalizeLockTtlMs
} from "./locking.js";
import { normalizeRetentionSweepPayload } from "./retentionQueue.js";

class RetentionLockHeldError extends Error {
  constructor({ lockKey = "", jobId = "", trigger = "", idempotencyKey = "" } = {}) {
    super("Retention sweep lock is already held.");
    this.name = "RetentionLockHeldError";
    this.code = "RETENTION_LOCK_HELD";
    this.lockKey = String(lockKey || "");
    this.jobId = String(jobId || "");
    this.trigger = String(trigger || "");
    this.idempotencyKey = String(idempotencyKey || "");
  }
}

function isRetentionLockHeldError(error) {
  return (
    Boolean(error) &&
    (String(error?.name || "") === "RetentionLockHeldError" || String(error?.code || "") === "RETENTION_LOCK_HELD")
  );
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function normalizeLockHeartbeatIntervalMs(lockTtlMs) {
  const normalizedTtlMs = normalizeLockTtlMs(lockTtlMs, 30 * 60 * 1000);
  return Math.min(Math.max(Math.floor(normalizedTtlMs / 3), 250), 60 * 1000);
}

function createRetentionSweepProcessor({
  logger = null,
  retentionConfig = {},
  lockConnection = null,
  lockKey = RETENTION_SWEEP_LOCK_KEY,
  lockTtlMs = 30 * 60 * 1000,
  acquireDistributedLockImpl = acquireDistributedLock,
  releaseDistributedLockImpl = releaseDistributedLock,
  extendDistributedLockImpl = extendDistributedLock,
  createRepositoriesImpl = createRepositories,
  createRetentionServiceImpl = createRetentionService
} = {}) {
  const normalizedLockTtlMs = normalizeLockTtlMs(lockTtlMs, 30 * 60 * 1000);
  const repositories = createRepositoriesImpl();
  const retentionService = createRetentionServiceImpl({
    consoleErrorLogsRepository: repositories.consoleErrorLogsRepository,
    workspaceInvitesRepository: repositories.workspaceInvitesRepository,
    consoleInvitesRepository: repositories.consoleInvitesRepository,
    auditEventsRepository: repositories.auditEventsRepository,
    aiTranscriptConversationsRepository: repositories.aiTranscriptConversationsRepository,
    aiTranscriptMessagesRepository: repositories.aiTranscriptMessagesRepository,
    billingRepository: repositories.billingRepository || null,
    retentionConfig: {
      errorLogRetentionDays: toPositiveInteger(retentionConfig.errorLogRetentionDays, 30),
      inviteArtifactRetentionDays: toPositiveInteger(retentionConfig.inviteArtifactRetentionDays, 90),
      securityAuditRetentionDays: toPositiveInteger(retentionConfig.securityAuditRetentionDays, 365),
      aiTranscriptsRetentionDays: toPositiveInteger(retentionConfig.aiTranscriptsRetentionDays, 60),
      billingIdempotencyRetentionDays: toPositiveInteger(retentionConfig.billingIdempotencyRetentionDays, 30),
      billingWebhookPayloadRetentionDays: toPositiveInteger(retentionConfig.billingWebhookPayloadRetentionDays, 30),
      batchSize: toPositiveInteger(retentionConfig.batchSize, 1000)
    }
  });

  return async function processRetentionSweep(job = {}) {
    const payload = normalizeRetentionSweepPayload(job.data || {});
    const jobId = String(job.id || "");
    const lockToken = `retention:${jobId || "unknown"}:${randomUUID()}`;
    let lockAcquired = false;
    let lockExtensionFailed = false;
    let lockHeartbeatPromise = null;
    let lockHeartbeatTimer = null;

    async function stopLockHeartbeat() {
      if (lockHeartbeatTimer) {
        clearInterval(lockHeartbeatTimer);
        lockHeartbeatTimer = null;
      }

      if (lockHeartbeatPromise) {
        try {
          await lockHeartbeatPromise;
        } catch {
          // Lock extension errors are tracked via lockExtensionFailed flag.
        }
      }
    }

    if (logger && typeof logger.info === "function") {
      logger.info(
        {
          jobId,
          dryRun: payload.dryRun,
          trigger: payload.trigger,
          requestedBy: payload.requestedBy,
          idempotencyKey: payload.idempotencyKey || ""
        },
        "worker.retention.started"
      );
    }

    if (lockConnection) {
      lockAcquired = await acquireDistributedLockImpl({
        connection: lockConnection,
        key: lockKey,
        token: lockToken,
        ttlMs: normalizedLockTtlMs
      });
      if (!lockAcquired) {
        if (logger && typeof logger.warn === "function") {
          logger.warn(
            {
              jobId,
              lockKey
            },
            "worker.retention.lock_held_retrying"
          );
        }

        throw new RetentionLockHeldError({
          jobId,
          lockKey,
          trigger: payload.trigger,
          idempotencyKey: payload.idempotencyKey || ""
        });
      }
    }

    if (lockConnection && lockAcquired && typeof extendDistributedLockImpl === "function") {
      const lockHeartbeatIntervalMs = normalizeLockHeartbeatIntervalMs(normalizedLockTtlMs);
      lockHeartbeatTimer = setInterval(() => {
        if (lockExtensionFailed || lockHeartbeatPromise) {
          return;
        }

        lockHeartbeatPromise = (async () => {
          const extended = await extendDistributedLockImpl({
            connection: lockConnection,
            key: lockKey,
            token: lockToken,
            ttlMs: normalizedLockTtlMs
          });
          if (!extended) {
            lockExtensionFailed = true;
            if (logger && typeof logger.warn === "function") {
              logger.warn(
                {
                  jobId,
                  lockKey
                },
                "worker.retention.lock_extend_failed"
              );
            }
          }
        })()
          .catch((error) => {
            lockExtensionFailed = true;
            if (logger && typeof logger.warn === "function") {
              logger.warn(
                {
                  err: error,
                  jobId,
                  lockKey
                },
                "worker.retention.lock_extend_failed"
              );
            }
          })
          .finally(() => {
            lockHeartbeatPromise = null;
          });
      }, lockHeartbeatIntervalMs);

      if (typeof lockHeartbeatTimer.unref === "function") {
        lockHeartbeatTimer.unref();
      }
    }

    try {
      const result = await retentionService.runSweep({
        dryRun: payload.dryRun,
        logger
      });

      await stopLockHeartbeat();

      if (lockExtensionFailed) {
        throw new Error("Retention lock extension failed during sweep execution.");
      }

      const totalDeletedRows = Number(result?.totalDeletedRows || 0);

      if (logger && typeof logger.info === "function") {
        logger.info(
          {
            jobId,
            totalDeletedRows,
            dryRun: payload.dryRun
          },
          "worker.retention.completed"
        );
      }

      return {
        ...result,
        trigger: payload.trigger,
        requestedBy: payload.requestedBy,
        idempotencyKey: payload.idempotencyKey || ""
      };
    } finally {
      await stopLockHeartbeat();

      if (lockConnection && lockAcquired) {
        try {
          await releaseDistributedLockImpl({
            connection: lockConnection,
            key: lockKey,
            token: lockToken
          });
        } catch (error) {
          if (logger && typeof logger.warn === "function") {
            logger.warn(
              {
                err: error,
                jobId,
                lockKey
              },
              "worker.retention.lock_release_failed"
            );
          }
        }
      }
    }
  };
}

const __testables = {
  toPositiveInteger,
  normalizeLockHeartbeatIntervalMs,
  isRetentionLockHeldError
};

export { createRetentionSweepProcessor, RetentionLockHeldError, isRetentionLockHeldError, __testables };
