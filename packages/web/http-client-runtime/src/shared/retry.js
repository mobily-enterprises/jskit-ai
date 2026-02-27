const DEFAULT_RETRYABLE_CSRF_ERROR_CODES = Object.freeze(["FST_CSRF_INVALID_TOKEN", "FST_CSRF_MISSING_SECRET"]);

function toUpperStringSet(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  return new Set(
    source
      .map((value) =>
        String(value || "")
          .trim()
          .toUpperCase()
      )
      .filter(Boolean)
  );
}

function shouldRetryForCsrfFailure({
  response,
  method,
  state,
  data,
  unsafeMethods,
  retryableErrorCodes = DEFAULT_RETRYABLE_CSRF_ERROR_CODES
}) {
  const methodValue = String(method || "")
    .trim()
    .toUpperCase();
  if (Number(response?.status) !== 403 || !unsafeMethods?.has(methodValue) || state?.csrfRetried) {
    return false;
  }

  const code = String(data?.details?.code || "")
    .trim()
    .toUpperCase();
  const retryableCodes = toUpperStringSet(retryableErrorCodes, DEFAULT_RETRYABLE_CSRF_ERROR_CODES);
  return retryableCodes.has(code);
}

export { DEFAULT_RETRYABLE_CSRF_ERROR_CODES, shouldRetryForCsrfFailure };
