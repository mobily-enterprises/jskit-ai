import IORedis from "ioredis";

const WORKER_REDIS_CONNECT_TIMEOUT_MS = 5000;
const WORKER_REDIS_QUIT_TIMEOUT_MS = 3000;
const WORKER_REDIS_RETRY_BASE_DELAY_MS = 250;
const WORKER_REDIS_RETRY_MAX_DELAY_MS = 5000;

function normalizeRedisUrl(redisUrl) {
  const normalized = String(redisUrl || "").trim();
  return normalized || "";
}

function resolveWorkerRedisRetryDelayMs(retryCountValue) {
  const retryCount = Number(retryCountValue);
  if (!Number.isInteger(retryCount) || retryCount < 1) {
    return WORKER_REDIS_RETRY_BASE_DELAY_MS;
  }

  const exponentialDelay = WORKER_REDIS_RETRY_BASE_DELAY_MS * 2 ** (retryCount - 1);
  return Math.min(exponentialDelay, WORKER_REDIS_RETRY_MAX_DELAY_MS);
}

function createWorkerRedisConnectionOptions(options = {}) {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: WORKER_REDIS_CONNECT_TIMEOUT_MS,
    retryStrategy: (retryCount) => resolveWorkerRedisRetryDelayMs(retryCount),
    ...(options && typeof options === "object" ? options : {})
  };
}

function normalizeWorkerRedisQuitTimeoutMs(value, fallback = WORKER_REDIS_QUIT_TIMEOUT_MS) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, 60_000);
}

function createWorkerRedisConnection({ redisUrl, connectionCtor = IORedis, connectionOptions = {} } = {}) {
  const normalizedRedisUrl = normalizeRedisUrl(redisUrl);
  if (!normalizedRedisUrl) {
    throw new Error("REDIS_URL is required for worker runtime.");
  }

  return new connectionCtor(normalizedRedisUrl, createWorkerRedisConnectionOptions(connectionOptions));
}

async function closeWorkerRedisConnection(connection, { quitTimeoutMs = WORKER_REDIS_QUIT_TIMEOUT_MS } = {}) {
  if (!connection) {
    return;
  }

  const normalizedQuitTimeoutMs = normalizeWorkerRedisQuitTimeoutMs(quitTimeoutMs, WORKER_REDIS_QUIT_TIMEOUT_MS);

  if (typeof connection.quit === "function") {
    let timeoutHandle = null;
    let quitTimedOut = false;
    try {
      await Promise.race([
        connection.quit(),
        new Promise((resolve) => {
          timeoutHandle = setTimeout(() => {
            quitTimedOut = true;
            resolve();
          }, normalizedQuitTimeoutMs);
        })
      ]);
      if (!quitTimedOut) {
        return;
      }
    } catch {
      // Fall through to disconnect below.
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    }
  }

  if (typeof connection.disconnect === "function") {
    connection.disconnect();
    return;
  }

  if (typeof connection.destroy === "function") {
    connection.destroy();
  }
}

const __testables = {
  normalizeRedisUrl,
  createWorkerRedisConnectionOptions,
  normalizeWorkerRedisQuitTimeoutMs,
  resolveWorkerRedisRetryDelayMs
};

export { createWorkerRedisConnection, closeWorkerRedisConnection, __testables };
