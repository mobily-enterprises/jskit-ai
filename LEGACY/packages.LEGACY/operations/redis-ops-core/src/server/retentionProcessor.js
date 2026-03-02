import { randomUUID } from "node:crypto";
import { createRetentionSweepLockKey } from "./workerConstants.js";
import {
  acquireDistributedLock,
  releaseDistributedLock,
  extendDistributedLock,
  normalizeLockTtlMs
} from "./workerLocking.js";
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

function normalizeLockHeartbeatIntervalMs(lockTtlMs) {
  const normalizedTtlMs = normalizeLockTtlMs(lockTtlMs, 30 * 60 * 1000);
  return Math.min(Math.max(Math.floor(normalizedTtlMs / 3), 250), 60 * 1000);
}

function createRetentionSweepProcessor({
  logger = null,
  redisNamespace,
  lockConnection = null,
  lockTtlMs = 30 * 60 * 1000,
  runSweep,
  normalizePayload = normalizeRetentionSweepPayload,
  acquireDistributedLockImpl = acquireDistributedLock,
  releaseDistributedLockImpl = releaseDistributedLock,
  extendDistributedLockImpl = extendDistributedLock
} = {}) {
  if (typeof runSweep !== "function") {
    throw new Error("runSweep is required.");
  }

  const lockKey = createRetentionSweepLockKey(redisNamespace);
  const normalizedLockTtlMs = normalizeLockTtlMs(lockTtlMs, 30 * 60 * 1000);

  return async function processRetentionSweep(job = {}) {
    const payloadNormalizer = typeof normalizePayload === "function" ? normalizePayload : normalizeRetentionSweepPayload;
    const payload = payloadNormalizer(job.data || {});
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
      const result = await runSweep({
        dryRun: payload.dryRun,
        logger,
        payload,
        job
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
        ...(result && typeof result === "object" ? result : {}),
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
  normalizeLockHeartbeatIntervalMs,
  isRetentionLockHeldError
};

export { createRetentionSweepProcessor, RetentionLockHeldError, isRetentionLockHeldError, __testables };
