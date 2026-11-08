import { normalizeCanonicalRecordIdText } from "@jskit-ai/kernel/shared/support/normalize";
import { isLostDuplicateInsertRace } from "./duplicateEntry.js";

function parseJsonObject(value, fallback = {}) {
  const source = String(value || "").trim();
  if (!source) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function stringifyJsonObject(value, fallback = "{}") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function normalizeNullableString(value, { trim = true } = {}) {
  if (value == null) {
    return null;
  }

  const source = String(value);
  const normalized = trim ? source.trim() : source;
  return normalized || null;
}

function normalizeDbRecordId(value, { fallback = null } = {}) {
  if (value == null) {
    return fallback;
  }

  if (typeof value === "string") {
    return normalizeCanonicalRecordIdText(value, { fallback });
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) {
      return fallback;
    }
    return normalizeCanonicalRecordIdText(value, { fallback });
  }

  if (typeof value === "bigint") {
    if (value < 1n) {
      return fallback;
    }
    return normalizeCanonicalRecordIdText(value, { fallback });
  }

  if (typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "id")) {
    return normalizeDbRecordId(value.id, { fallback });
  }

  return normalizeCanonicalRecordIdText(value, { fallback });
}

function resolveInsertedRecordId(insertResult, { fallback = null } = {}) {
  if (Array.isArray(insertResult) && insertResult.length > 0) {
    return normalizeDbRecordId(insertResult[0], { fallback });
  }

  return normalizeDbRecordId(insertResult, { fallback });
}

function parseJsonValue(value, fallback = null, options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const effectiveFallback = Object.hasOwn(source, "fallback") ? source.fallback : fallback;
  const allowNull = source.allowNull === true;
  const allowObject = source.allowObject !== false;
  const trim = source.trim !== false;

  if (value == null) {
    return effectiveFallback;
  }

  if (allowObject && typeof value === "object") {
    return value;
  }

  let text = String(value || "");
  if (trim) {
    text = text.trim();
  }

  if (!text) {
    return effectiveFallback;
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed == null && !allowNull) {
      return effectiveFallback;
    }
    return parsed;
  } catch {
    return effectiveFallback;
  }
}

function toDbJson(value) {
  if (value == null) {
    return JSON.stringify({});
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

/**
 * True when the error reports a transaction the database aborted, and rolled
 * back in full, as a deadlock victim, a SQLite write that found the database
 * locked by another connection (SQLITE_BUSY), or, with MariaDB's
 * innodb_snapshot_isolation on, a locking read of a row another transaction
 * changed after this one's snapshot ("Record has changed since last read",
 * errno 1020, ER_CHECKREAD); after the last two json-rest-api rolls its
 * transaction back, so a new run starts from a fresh snapshot. A wrapper that
 * reports its transaction committed (json-rest-api's transactionOutcome)
 * never is one.
 * @param {unknown} error
 */
function isDeadlockError(error) {
  const seen = new Set();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    if (error.transactionOutcome === "committed") {
      return false;
    }
    const code = String(error.code || "").toUpperCase();
    if (code === "ER_LOCK_DEADLOCK" || code === "ER_CHECKREAD" || code === "40P01" || code === "SQLITE_BUSY" ||
      Number(error.errno) === 1213 || Number(error.errno) === 1020) {
      return true;
    }
    error = error.cause;
  }
  return false;
}

/**
 * Runs a whole transaction again when the database chose it as a deadlock
 * victim, so `run` must be safe to repeat: no external effects inside it.
 * A lock wait that timed out is never run again: MySQL rolls back only the
 * timed-out statement, so the transaction's earlier work could repeat.
 * @template T
 * @param {() => Promise<T>} run
 * @param {{ retries?: number }} [options]
 * @returns {Promise<T>}
 */
async function retryDeadlocks(run, { retries = 3 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt > retries || !isDeadlockError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 * 2 ** attempt));
    }
  }
}

/**
 * Runs `run` once more when its insert lost a race for a unique key: another
 * request inserted the same key first (an idempotency or request key, a
 * revision number, a computed id), and `run`'s own transaction rolled back in
 * full (isLostDuplicateInsertRace). The database reports the duplicate only
 * once the winner has committed, so the second run reads a snapshot that holds
 * the winner's row: its lookup by the key finds it, and every other check sees
 * the current state. A second duplicate is final. `run` is a transaction
 * opened with these `options`, usually `() => repository.withTransaction(options,
 * work)`, and must be safe to repeat, as for a deadlock retry. Inside a
 * caller's transaction (`options.trx`) the failed insert has failed that
 * transaction, so `run` never runs again there: the error reaches the caller,
 * whose own retry, if it has one, runs the whole of it again.
 * @template T
 * @param {{ trx?: unknown }} options The options `run` opens its transaction with.
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
async function retryLostInsertRace(options, run, ...rest) {
  if (!options || typeof options !== "object" || typeof run !== "function" || rest.length > 0) {
    throw new TypeError(
      "retryLostInsertRace() takes (options, run): the options run opens its transaction with, then " +
        "run, such as () => repository.withTransaction(options, work)."
    );
  }
  try {
    return await run();
  } catch (error) {
    if (!isLostDuplicateInsertRace(error, options)) {
      throw error;
    }
    return run();
  }
}

export {
  parseJsonObject,
  stringifyJsonObject,
  normalizeNullableString,
  normalizeDbRecordId,
  resolveInsertedRecordId,
  parseJsonValue,
  toDbJson,
  isDeadlockError,
  retryDeadlocks,
  retryLostInsertRace
};
