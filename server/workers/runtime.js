import { Worker } from "bullmq";
import { RETENTION_QUEUE_NAME } from "./constants.js";
import { createRetentionDeadLetterQueue, enqueueRetentionDeadLetterJob } from "./deadLetterQueue.js";
import { createWorkerRedisConnection, closeWorkerRedisConnection } from "./redisConnection.js";
import { createRetentionSweepProcessor, isRetentionLockHeldError } from "./retentionProcessor.js";

const DEFAULT_LOCK_HELD_REQUEUE_DELAY_MS = 5000;
const MAX_LOCK_HELD_REQUEUE_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_LOCK_HELD_REQUEUE_MAX = 3;
const MAX_LOCK_HELD_REQUEUE_MAX = 1000;

function normalizeConcurrency(value, fallback = 2) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, 64);
}

function normalizeStartupTimeoutMs(value, fallback = 15_000) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000) {
    return fallback;
  }

  return Math.min(parsed, 120_000);
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutHandle = null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  });
}

function normalizeLockHeldRequeueDelayMs(value, fallback = DEFAULT_LOCK_HELD_REQUEUE_DELAY_MS) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, MAX_LOCK_HELD_REQUEUE_DELAY_MS);
}

function normalizeLockHeldRequeueMax(value, fallback = DEFAULT_LOCK_HELD_REQUEUE_MAX) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(parsed, MAX_LOCK_HELD_REQUEUE_MAX);
}

function resolveLockHeldRequeueDelayMs(job) {
  const candidateDelay = job?.opts?.backoff?.delay;
  return normalizeLockHeldRequeueDelayMs(candidateDelay, DEFAULT_LOCK_HELD_REQUEUE_DELAY_MS);
}

function resolveLockHeldRequeueCount(job) {
  const attempts = Number(job?.opts?.attempts || 0);
  const attemptsMade = Number(job?.attemptsMade || 0);

  if (attempts > 0 && attemptsMade >= attempts) {
    return attemptsMade - attempts + 1;
  }

  if (attemptsMade > 0) {
    return attemptsMade;
  }

  return 1;
}

function createLockHeldRequeueExhaustedError({ job, lockHeldRequeueCount, lockHeldRequeueMax, cause } = {}) {
  const error = new Error(
    `Retention sweep lock contention exceeded auto-requeue budget (${lockHeldRequeueCount}/${lockHeldRequeueMax}).`
  );
  error.name = "RetentionLockHeldRequeueExhaustedError";
  error.code = "RETENTION_LOCK_HELD_REQUEUE_EXHAUSTED";
  error.jobId = String(job?.id || "");
  error.lockHeldRequeueCount = Number(lockHeldRequeueCount || 0);
  error.lockHeldRequeueMax = Number(lockHeldRequeueMax || 0);
  error.cause = cause || null;
  return error;
}

function createLockHeldRequeueAbortedError({ job, lockHeldRequeueCount, lockHeldRequeueMax, reason = "", cause } = {}) {
  const error = new Error(
    `Retention sweep lock contention auto-requeue was aborted (${lockHeldRequeueCount}/${lockHeldRequeueMax})${
      reason ? `: ${reason}` : ""
    }.`
  );
  error.name = "RetentionLockHeldRequeueAbortedError";
  error.code = "RETENTION_LOCK_HELD_REQUEUE_ABORTED";
  error.jobId = String(job?.id || "");
  error.lockHeldRequeueCount = Number(lockHeldRequeueCount || 0);
  error.lockHeldRequeueMax = Number(lockHeldRequeueMax || 0);
  error.reason = String(reason || "");
  error.cause = cause || null;
  return error;
}

function createLockHeldRequeueUnavailableError({ job, lockHeldRequeueCount, lockHeldRequeueMax, cause } = {}) {
  const error = new Error(
    `Retention sweep lock contention auto-requeue is unavailable (${lockHeldRequeueCount}/${lockHeldRequeueMax}).`
  );
  error.name = "RetentionLockHeldRequeueUnavailableError";
  error.code = "RETENTION_LOCK_HELD_REQUEUE_UNAVAILABLE";
  error.jobId = String(job?.id || "");
  error.lockHeldRequeueCount = Number(lockHeldRequeueCount || 0);
  error.lockHeldRequeueMax = Number(lockHeldRequeueMax || 0);
  error.cause = cause || null;
  return error;
}

function createLockHeldRequeueFailedError({ job, lockHeldRequeueCount, lockHeldRequeueMax, cause } = {}) {
  const error = new Error(
    `Retention sweep lock contention auto-requeue failed (${lockHeldRequeueCount}/${lockHeldRequeueMax}).`
  );
  error.name = "RetentionLockHeldRequeueFailedError";
  error.code = "RETENTION_LOCK_HELD_REQUEUE_FAILED";
  error.jobId = String(job?.id || "");
  error.lockHeldRequeueCount = Number(lockHeldRequeueCount || 0);
  error.lockHeldRequeueMax = Number(lockHeldRequeueMax || 0);
  error.cause = cause || null;
  return error;
}

async function waitForLockHeldRequeueDelay(delayMs, { signal } = {}) {
  if (signal?.aborted) {
    return false;
  }

  return new Promise((resolve) => {
    let timeoutHandle = null;
    let settled = false;

    function settle(value) {
      if (settled) {
        return;
      }
      settled = true;

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }

      resolve(value);
    }

    function onAbort() {
      settle(false);
    }

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timeoutHandle = setTimeout(() => {
      settle(true);
    }, delayMs);
    if (typeof timeoutHandle.unref === "function") {
      timeoutHandle.unref();
    }
  });
}

function createLogger(logger = null) {
  return {
    info(payload, message) {
      if (logger && typeof logger.info === "function") {
        logger.info(payload, message);
      }
    },
    warn(payload, message) {
      if (logger && typeof logger.warn === "function") {
        logger.warn(payload, message);
      }
    },
    error(payload, message) {
      if (logger && typeof logger.error === "function") {
        logger.error(payload, message);
      }
    }
  };
}

function createWorkerRuntime({
  redisUrl,
  workerConcurrency = 2,
  workerStartupTimeoutMs = 15_000,
  lockHeldRequeueMax = DEFAULT_LOCK_HELD_REQUEUE_MAX,
  retentionLockTtlMs = 30 * 60 * 1000,
  retentionConfig = {},
  logger = null,
  workerCtor = Worker,
  connectionFactory = createWorkerRedisConnection,
  createRetentionSweepProcessorImpl = createRetentionSweepProcessor,
  createRetentionDeadLetterQueueImpl = createRetentionDeadLetterQueue,
  enqueueRetentionDeadLetterJobImpl = enqueueRetentionDeadLetterJob
} = {}) {
  const appLogger = createLogger(logger);
  const concurrency = normalizeConcurrency(workerConcurrency, 2);
  const startupTimeoutMs = normalizeStartupTimeoutMs(workerStartupTimeoutMs, 15_000);
  const maxLockHeldRequeues = normalizeLockHeldRequeueMax(lockHeldRequeueMax, DEFAULT_LOCK_HELD_REQUEUE_MAX);

  let connection = null;
  let worker = null;
  let deadLetterQueue = null;
  let started = false;
  let stopping = false;
  let startPromise = null;
  let startupRuntimeErrorLogged = false;
  let lockHeldRequeueAbortController = new AbortController();
  const pendingLockHeldRequeues = new Set();
  const pendingDeadLetterEnqueues = new Set();

  function toCloseError(errors, message) {
    if (!Array.isArray(errors) || errors.length === 0) {
      return null;
    }

    if (errors.length === 1) {
      return errors[0];
    }

    return new AggregateError(errors, message);
  }

  async function closeRuntimeResources({ phase }) {
    stopping = true;
    if (lockHeldRequeueAbortController && !lockHeldRequeueAbortController.signal.aborted) {
      lockHeldRequeueAbortController.abort();
    }

    const closeErrors = [];
    const activeWorker = worker;
    const activeDeadLetterQueue = deadLetterQueue;
    const activeConnection = connection;

    if (activeWorker && typeof activeWorker.close === "function") {
      try {
        await activeWorker.close();
      } catch (error) {
        closeErrors.push(error);
        appLogger.error(
          {
            err: error,
            queue: RETENTION_QUEUE_NAME,
            phase
          },
          "worker.runtime.worker_close_failed"
        );
      }
    }

    while (pendingLockHeldRequeues.size > 0) {
      const activeRequeues = Array.from(pendingLockHeldRequeues);
      await Promise.allSettled(activeRequeues);
    }

    while (pendingDeadLetterEnqueues.size > 0) {
      const activeEnqueues = Array.from(pendingDeadLetterEnqueues);
      await Promise.allSettled(activeEnqueues);
    }

    if (activeDeadLetterQueue && typeof activeDeadLetterQueue.close === "function") {
      try {
        await activeDeadLetterQueue.close();
      } catch (error) {
        closeErrors.push(error);
        appLogger.error(
          {
            err: error,
            queue: RETENTION_QUEUE_NAME,
            phase
          },
          "worker.runtime.dead_letter_queue_close_failed"
        );
      }
    }

    if (activeConnection) {
      try {
        await closeWorkerRedisConnection(activeConnection);
      } catch (error) {
        closeErrors.push(error);
        appLogger.error(
          {
            err: error,
            queue: RETENTION_QUEUE_NAME,
            phase
          },
          "worker.runtime.redis_close_failed"
        );
      }
    }

    worker = null;
    deadLetterQueue = null;
    connection = null;

    return closeErrors;
  }

  function isTerminalFailure(job) {
    const attempts = Number(job?.opts?.attempts || 0);
    const attemptsMade = Number(job?.attemptsMade || 0);
    return attempts > 0 ? attemptsMade >= attempts : true;
  }

  async function requeueTerminalLockHeldJob(job, error) {
    if (!isTerminalFailure(job)) {
      return false;
    }

    const lockHeldRequeueCount = resolveLockHeldRequeueCount(job);
    if (lockHeldRequeueCount > maxLockHeldRequeues) {
      appLogger.error(
        {
          queue: RETENTION_QUEUE_NAME,
          jobId: String(job?.id || ""),
          lockHeldRequeueCount,
          lockHeldRequeueMax: maxLockHeldRequeues
        },
        "worker.job.lock_held_requeue_exhausted"
      );
      await enqueueDeadLetterJob(
        job,
        createLockHeldRequeueExhaustedError({
          job,
          lockHeldRequeueCount,
          lockHeldRequeueMax: maxLockHeldRequeues,
          cause: error
        }),
        {
          includeLockHeldError: true
        }
      );
      return false;
    }

    if (!job || typeof job.retry !== "function") {
      const unavailableError = createLockHeldRequeueUnavailableError({
        job,
        lockHeldRequeueCount,
        lockHeldRequeueMax: maxLockHeldRequeues,
        cause: error
      });
      appLogger.error(
        {
          queue: RETENTION_QUEUE_NAME,
          jobId: String(job?.id || "")
        },
        "worker.job.lock_held_requeue_unavailable"
      );
      await enqueueDeadLetterJob(job, unavailableError, {
        includeLockHeldError: true
      });
      return false;
    }

    const requeueDelayMs = resolveLockHeldRequeueDelayMs(job);

    try {
      const delayElapsed = await waitForLockHeldRequeueDelay(requeueDelayMs, {
        signal: lockHeldRequeueAbortController.signal
      });
      if (!delayElapsed || stopping || !worker) {
        const abortReason = !delayElapsed
          ? "shutdown_abort_signal"
          : !worker
            ? "worker_unavailable"
            : "shutdown_in_progress";
        const abortedError = createLockHeldRequeueAbortedError({
          job,
          lockHeldRequeueCount,
          lockHeldRequeueMax: maxLockHeldRequeues,
          reason: abortReason,
          cause: error
        });
        appLogger.error(
          {
            queue: RETENTION_QUEUE_NAME,
            jobId: String(job?.id || ""),
            lockHeldRequeueCount,
            lockHeldRequeueMax: maxLockHeldRequeues,
            reason: abortReason
          },
          "worker.job.lock_held_requeue_aborted"
        );
        await enqueueDeadLetterJob(job, abortedError, {
          includeLockHeldError: true
        });
        return false;
      }
      await job.retry();
      appLogger.warn(
        {
          queue: RETENTION_QUEUE_NAME,
          jobId: String(job?.id || ""),
          delayMs: requeueDelayMs
        },
        "worker.job.lock_held_requeued"
      );
      return true;
    } catch (error) {
      const requeueFailedError = createLockHeldRequeueFailedError({
        job,
        lockHeldRequeueCount,
        lockHeldRequeueMax: maxLockHeldRequeues,
        cause: error
      });
      appLogger.error(
        {
          err: error,
          queue: RETENTION_QUEUE_NAME,
          jobId: String(job?.id || "")
        },
        "worker.job.lock_held_requeue_failed"
      );
      await enqueueDeadLetterJob(job, requeueFailedError, {
        includeLockHeldError: true
      });
      return false;
    }
  }

  function requeueTerminalLockHeldJobTracked(job, error) {
    const pendingRequeue = requeueTerminalLockHeldJob(job, error).finally(() => {
      pendingLockHeldRequeues.delete(pendingRequeue);
    });
    pendingLockHeldRequeues.add(pendingRequeue);
  }

  async function enqueueDeadLetterJob(job, error, { includeLockHeldError = false } = {}) {
    if (isRetentionLockHeldError(error) && !includeLockHeldError) {
      return;
    }

    const attemptsMade = Number(job?.attemptsMade || 0);
    if (!isTerminalFailure(job)) {
      return;
    }

    if (!deadLetterQueue) {
      return;
    }

    try {
      await enqueueRetentionDeadLetterJobImpl({
        queue: deadLetterQueue,
        job,
        error
      });
      appLogger.error(
        {
          queue: RETENTION_QUEUE_NAME,
          jobId: String(job?.id || ""),
          attemptsMade
        },
        "worker.job.dead_lettered"
      );
    } catch (deadLetterError) {
      appLogger.error(
        {
          err: deadLetterError,
          queue: RETENTION_QUEUE_NAME,
          jobId: String(job?.id || "")
        },
        "worker.job.dead_letter_failed"
      );
    }
  }

  function enqueueDeadLetterJobTracked(job, error) {
    const pendingEnqueue = enqueueDeadLetterJob(job, error).finally(() => {
      pendingDeadLetterEnqueues.delete(pendingEnqueue);
    });
    pendingDeadLetterEnqueues.add(pendingEnqueue);
  }

  async function start() {
    if (started) {
      return {
        queue: RETENTION_QUEUE_NAME,
        concurrency
      };
    }

    if (startPromise) {
      return startPromise;
    }

    startPromise = (async () => {
      if (started) {
        return {
          queue: RETENTION_QUEUE_NAME,
          concurrency
        };
      }

      stopping = false;
      lockHeldRequeueAbortController = new AbortController();
      connection = connectionFactory({ redisUrl });
      startupRuntimeErrorLogged = false;

      try {
        deadLetterQueue = createRetentionDeadLetterQueueImpl({
          connection
        });
        const processor = createRetentionSweepProcessorImpl({
          logger: appLogger,
          retentionConfig,
          lockConnection: connection,
          lockTtlMs: retentionLockTtlMs
        });

        worker = new workerCtor(RETENTION_QUEUE_NAME, processor, {
          connection,
          concurrency
        });

        worker.on("failed", (job, error) => {
          if (isRetentionLockHeldError(error)) {
            appLogger.warn(
              {
                queue: RETENTION_QUEUE_NAME,
                jobId: String(job?.id || ""),
                attemptsMade: Number(job?.attemptsMade || 0),
                attempts: Number(job?.opts?.attempts || 0)
              },
              "worker.job.lock_held_retrying"
            );
            requeueTerminalLockHeldJobTracked(job, error);
          } else {
            appLogger.error(
              {
                err: error,
                queue: RETENTION_QUEUE_NAME,
                jobId: String(job?.id || "")
              },
              "worker.job.failed"
            );
            enqueueDeadLetterJobTracked(job, error);
          }
        });

        worker.on("error", (error) => {
          if (!started && startupRuntimeErrorLogged) {
            return;
          }
          startupRuntimeErrorLogged = true;
          appLogger.error(
            {
              err: error,
              queue: RETENTION_QUEUE_NAME
            },
            "worker.runtime.error"
          );
        });

        if (typeof worker.waitUntilReady === "function") {
          await withTimeout(
            worker.waitUntilReady(),
            startupTimeoutMs,
            `Worker runtime failed to become ready within ${startupTimeoutMs}ms.`
          );
        }

        started = true;
        startupRuntimeErrorLogged = false;
        appLogger.info(
          {
            queue: RETENTION_QUEUE_NAME,
            concurrency
          },
          "worker.runtime.started"
        );

        return {
          queue: RETENTION_QUEUE_NAME,
          concurrency
        };
      } catch (error) {
        const closeErrors = await closeRuntimeResources({
          phase: "start"
        });
        const closeError = toCloseError(closeErrors, "Failed to close worker runtime resources after startup error.");
        if (closeError) {
          appLogger.error(
            {
              err: closeError,
              queue: RETENTION_QUEUE_NAME
            },
            "worker.runtime.cleanup_failed_after_start_error"
          );
        }
        throw error;
      }
    })();

    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  async function stop() {
    const closeErrors = await closeRuntimeResources({
      phase: "stop"
    });
    const closeError = toCloseError(closeErrors, "Failed to close worker runtime resources.");

    if (started) {
      appLogger.info(
        {
          queue: RETENTION_QUEUE_NAME
        },
        "worker.runtime.stopped"
      );
    }
    started = false;
    stopping = false;
    startupRuntimeErrorLogged = false;

    if (closeError) {
      throw closeError;
    }
  }

  return {
    start,
    stop
  };
}

const __testables = {
  normalizeConcurrency,
  normalizeStartupTimeoutMs,
  normalizeLockHeldRequeueDelayMs,
  normalizeLockHeldRequeueMax,
  resolveLockHeldRequeueCount
};

export { createWorkerRuntime, __testables };
