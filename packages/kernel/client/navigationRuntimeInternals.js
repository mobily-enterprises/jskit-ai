import { watch } from "vue";
import { isRecord } from "../shared/navigationInternals.js";

function createNavigationAbortError() {
  const error = new Error("JSKIT navigation transaction was aborted.");
  error.name = "AbortError";
  return error;
}

function isNavigationAbortError(error) {
  return error?.name === "AbortError";
}

function settleNavigationWithin(promise, { signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;

    function finish(result, error = null) {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }

    function onAbort() {
      finish(null, createNavigationAbortError());
    }

    if (signal?.aborted) {
      finish(null, createNavigationAbortError());
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    timeoutId = setTimeout(() => finish(Object.freeze({ completed: false })), timeoutMs);
    Promise.resolve(promise).then(
      (value) => finish(Object.freeze({ completed: true, value })),
      (error) => finish(null, error)
    );
  });
}

async function waitForNavigationReadiness(check, { signal, timeoutMs }) {
  if (typeof check !== "function") {
    return true;
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let stop = () => {};
    let timeoutId = null;
    let evaluation = 0;

    function finish(value, error = null) {
      if (settled) {
        return;
      }
      settled = true;
      stop();
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }

    function onAbort() {
      finish(false, createNavigationAbortError());
    }

    async function inspect(value, currentEvaluation) {
      try {
        const ready = await value;
        if (currentEvaluation === evaluation && ready) {
          finish(true);
        }
      } catch (error) {
        finish(false, error);
      }
    }

    if (signal?.aborted) {
      finish(false, createNavigationAbortError());
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    timeoutId = setTimeout(() => finish(false), timeoutMs);
    stop = watch(
      () => {
        try {
          return check();
        } catch (error) {
          return Promise.reject(error);
        }
      },
      (value) => {
        evaluation += 1;
        void inspect(value, evaluation);
      },
      { immediate: true }
    );
  });
}

function normalizeNavigationScrollCoordinate(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function createNavigationRestoreContext({
  transactionId,
  reason,
  route,
  browserEntry,
  destinationEntry,
  scope,
  signal
}) {
  return Object.freeze({
    transactionId,
    reason,
    route: Object.freeze({
      fullPath: String(route?.fullPath || route?.path || "/"),
      path: String(route?.path || "/"),
      query: isRecord(route?.query) ? { ...route.query } : {},
      hash: String(route?.hash || "")
    }),
    browserEntryId: browserEntry.browserEntryId,
    destinationEntryId: destinationEntry.destinationEntryId,
    scope,
    signal
  });
}

export {
  createNavigationAbortError,
  createNavigationRestoreContext,
  isNavigationAbortError,
  normalizeNavigationScrollCoordinate,
  settleNavigationWithin,
  waitForNavigationReadiness
};
