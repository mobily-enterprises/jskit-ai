const TRANSIENT_QUERY_ERROR_STATUSES = Object.freeze(new Set([0, 502, 503, 504]));
const MAX_TRANSIENT_QUERY_RETRIES = 2;
const MAX_TRANSIENT_RETRY_DELAY_MS = 3000;
// Set by a transport that already retried a transient failure of a safe request. A registry symbol, so copies of
// this module in different packages agree on it.
const TRANSIENT_RETRIES_SPENT = Symbol.for("@jskit-ai/kernel.transientRetriesSpent");

function normalizeQueryErrorStatus(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  return Number.isInteger(status) ? status : 0;
}

function isTransientQueryError(error) {
  return TRANSIENT_QUERY_ERROR_STATUSES.has(normalizeQueryErrorStatus(error));
}

/**
 * Marks an error whose request the transport already retried for being transient, so a query does not retry the
 * whole retried call again: one unreachable read is then three requests, not nine.
 * @template {unknown} T
 * @param {T} error
 * @returns {T}
 */
function markTransientRetriesSpent(error) {
  if (error && typeof error === "object") {
    Object.defineProperty(error, TRANSIENT_RETRIES_SPENT, { value: true, configurable: true });
  }
  return error;
}

function shouldRetryTransientQueryFailure(failureCount, error) {
  if (!isTransientQueryError(error) || error?.[TRANSIENT_RETRIES_SPENT] === true) {
    return false;
  }
  return Number(failureCount) < MAX_TRANSIENT_QUERY_RETRIES;
}

function transientQueryRetryDelay(attemptIndex) {
  const normalizedAttempt = Number.isInteger(Number(attemptIndex)) ? Number(attemptIndex) : 1;
  return Math.min(1000 * 2 ** Math.max(0, normalizedAttempt - 1), MAX_TRANSIENT_RETRY_DELAY_MS);
}

export {
  TRANSIENT_QUERY_ERROR_STATUSES,
  MAX_TRANSIENT_QUERY_RETRIES,
  MAX_TRANSIENT_RETRY_DELAY_MS,
  normalizeQueryErrorStatus,
  isTransientQueryError,
  markTransientRetriesSpent,
  shouldRetryTransientQueryFailure,
  transientQueryRetryDelay
};
