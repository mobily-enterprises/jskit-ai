import { normalizeCanonicalRecordIdText } from "@jskit-ai/kernel/shared/support/normalize";

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
 * back in full, as a deadlock victim. A wrapper that reports its transaction
 * committed (json-rest-api's transactionOutcome) never is one.
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
    if (code === "ER_LOCK_DEADLOCK" || code === "40P01" || Number(error.errno) === 1213) {
      return true;
    }
    error = error.cause;
  }
  return false;
}

/**
 * Runs a whole transaction again when the database chose it as a deadlock
 * victim, so `run` must be safe to repeat: no external effects inside it.
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

export {
  parseJsonObject,
  stringifyJsonObject,
  normalizeNullableString,
  normalizeDbRecordId,
  resolveInsertedRecordId,
  parseJsonValue,
  toDbJson,
  isDeadlockError,
  retryDeadlocks
};
