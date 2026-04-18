import { createHttpClient } from "../shared/clientRuntime/client.js";
import {
  isTransientQueryError,
  transientQueryRetryDelay
} from "@jskit-ai/kernel/shared/support";

const SAFE_RETRY_METHODS = Object.freeze(new Set(["GET", "HEAD"]));
const MAX_TRANSIENT_HTTP_RETRIES = 2;

function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function shouldRetryTransientHttpFailure(error, method, attemptIndex) {
  if (!SAFE_RETRY_METHODS.has(String(method || "GET").toUpperCase())) {
    return false;
  }
  if (!isTransientQueryError(error)) {
    return false;
  }
  return Number(attemptIndex) < MAX_TRANSIENT_HTTP_RETRIES;
}

async function requestWithTransientRetry(executor, method) {
  let attemptIndex = 0;

  while (true) {
    try {
      return await executor();
    } catch (error) {
      if (!shouldRetryTransientHttpFailure(error, method, attemptIndex)) {
        throw error;
      }
      attemptIndex += 1;
      await sleep(transientQueryRetryDelay(attemptIndex));
    }
  }
}

function createTransientRetryHttpClient(options = {}) {
  const baseHttpClient = createHttpClient(options);

  return Object.freeze({
    ...baseHttpClient,
    request(url, requestOptions = {}, state = null) {
      const method = String(requestOptions?.method || "GET").toUpperCase();
      return requestWithTransientRetry(
        () => baseHttpClient.request(url, requestOptions, state),
        method
      );
    },
    requestStream(url, requestOptions = {}, handlers = {}, state = null) {
      const method = String(requestOptions?.method || "GET").toUpperCase();
      return requestWithTransientRetry(
        () => baseHttpClient.requestStream(url, requestOptions, handlers, state),
        method
      );
    }
  });
}

export { createTransientRetryHttpClient };
