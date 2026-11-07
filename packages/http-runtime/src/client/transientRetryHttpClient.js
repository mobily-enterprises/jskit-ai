import { createHttpClient } from "../shared/clientRuntime/client.js";
import {
  isTransientQueryError,
  markTransientRetriesSpent,
  transientQueryRetryDelay
} from "@jskit-ai/kernel/shared/support";

const SAFE_RETRY_METHODS = Object.freeze(new Set(["GET", "HEAD"]));
const MAX_TRANSIENT_HTTP_RETRIES = 2;

function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function retriesTransientHttpFailure(error, method) {
  if (error?.name === "AbortError" || error?.name === "TimeoutError") {
    return false;
  }
  if (!SAFE_RETRY_METHODS.has(String(method || "GET").toUpperCase())) {
    return false;
  }
  return isTransientQueryError(error);
}

async function requestWithTransientRetry(executor, method, signal) {
  let attemptIndex = 0;

  while (true) {
    signal?.throwIfAborted();
    try {
      return await executor();
    } catch (error) {
      signal?.throwIfAborted();
      if (!retriesTransientHttpFailure(error, method)) {
        throw error;
      }
      if (attemptIndex >= MAX_TRANSIENT_HTTP_RETRIES) {
        // This layer owns the retries of a safe request; a query must not repeat them.
        throw markTransientRetriesSpent(error);
      }
      attemptIndex += 1;
      await sleep(transientQueryRetryDelay(attemptIndex));
    }
  }
}

/**
 * An HTTP client whose every request retries transient failures of safe methods.
 * @param {import("./types.js").HttpClientOptions} [options]
 */
function createTransientRetryHttpClient(options) {
  const baseHttpClient = createHttpClient(options);

  function request(url, requestOptions = {}, state = null) {
    const method = String(requestOptions.method || "GET").toUpperCase();
    return requestWithTransientRetry(
      () => baseHttpClient.request(url, requestOptions, state),
      method,
      requestOptions.signal
    );
  }

  function requestStream(url, requestOptions = {}, handlers = {}, state = null) {
    const method = String(requestOptions.method || "GET").toUpperCase();
    return requestWithTransientRetry(
      () => baseHttpClient.requestStream(url, requestOptions, handlers, state),
      method,
      requestOptions.signal
    );
  }

  return Object.freeze({
    request,
    requestStream,
    ensureCsrfToken: baseHttpClient.ensureCsrfToken,
    clearCsrfTokenCache: baseHttpClient.clearCsrfTokenCache
  });
}

export { createTransientRetryHttpClient };
