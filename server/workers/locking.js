const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const EXTEND_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

function normalizeLockTtlMs(value, fallback = 15 * 60 * 1000) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 1000), 24 * 60 * 60 * 1000);
}

function normalizeLockKey(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function normalizeLockToken(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

async function acquireDistributedLock({ connection, key, token, ttlMs } = {}) {
  if (!connection || typeof connection.set !== "function") {
    throw new Error("Redis connection with set() is required.");
  }

  const lockKey = normalizeLockKey(key);
  const lockToken = normalizeLockToken(token);
  if (!lockKey || !lockToken) {
    throw new Error("Lock key and token are required.");
  }

  const result = await connection.set(lockKey, lockToken, "PX", normalizeLockTtlMs(ttlMs), "NX");
  return result === "OK";
}

async function releaseDistributedLock({ connection, key, token } = {}) {
  if (!connection || typeof connection.eval !== "function") {
    throw new Error("Redis connection with eval() is required.");
  }

  const lockKey = normalizeLockKey(key);
  const lockToken = normalizeLockToken(token);
  if (!lockKey || !lockToken) {
    throw new Error("Lock key and token are required.");
  }

  const releasedCount = Number(await connection.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockToken));
  return releasedCount > 0;
}

async function extendDistributedLock({ connection, key, token, ttlMs } = {}) {
  if (!connection || typeof connection.eval !== "function") {
    throw new Error("Redis connection with eval() is required.");
  }

  const lockKey = normalizeLockKey(key);
  const lockToken = normalizeLockToken(token);
  if (!lockKey || !lockToken) {
    throw new Error("Lock key and token are required.");
  }

  const extendedCount = Number(
    await connection.eval(EXTEND_LOCK_SCRIPT, 1, lockKey, lockToken, normalizeLockTtlMs(ttlMs))
  );
  return extendedCount > 0;
}

const __testables = {
  RELEASE_LOCK_SCRIPT,
  EXTEND_LOCK_SCRIPT,
  normalizeLockTtlMs,
  normalizeLockKey,
  normalizeLockToken
};

export { acquireDistributedLock, releaseDistributedLock, extendDistributedLock, normalizeLockTtlMs, __testables };
