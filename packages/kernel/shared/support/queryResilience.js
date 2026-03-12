const TRANSIENT_QUERY_ERROR_STATUSES = Object.freeze(new Set([0, 502, 503, 504]));
const MAX_TRANSIENT_QUERY_RETRIES = 2;
const MAX_TRANSIENT_RETRY_DELAY_MS = 3000;

function normalizeQueryErrorStatus(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  return Number.isInteger(status) ? status : 0;
}

function isTransientQueryError(error) {
  return TRANSIENT_QUERY_ERROR_STATUSES.has(normalizeQueryErrorStatus(error));
}

function shouldRetryTransientQueryFailure(failureCount, error) {
  if (!isTransientQueryError(error)) {
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
  shouldRetryTransientQueryFailure,
  transientQueryRetryDelay
};
