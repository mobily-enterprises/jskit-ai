import { guardedReloadApp } from "@jskit-ai/kernel/client/asyncModuleRecovery";
import { isRecord } from "@jskit-ai/kernel/shared/support";
import { createProviderLogger as createSharedProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";

const REQUEST_RECOVERY_RELOAD_FAILURE_MESSAGE =
  "The app cannot reload because the app server is not reachable. Restart the server, then click Reload.";

const RECOVERABLE_REQUEST_ERROR_MESSAGES = Object.freeze([
  /Failed to fetch/iu,
  /Load failed/iu,
  /Network request failed/iu,
  /NetworkError when attempting to fetch resource/iu,
  /The Internet connection appears to be offline/iu
]);

const RECOVERABLE_REQUEST_ERROR_CODES = Object.freeze(new Set([
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ERR_NETWORK",
  "ETIMEDOUT"
]));

const CANCELED_REQUEST_ERROR_CODES = Object.freeze(new Set([
  "ABORT_ERR",
  "ERR_ABORTED",
  "ERR_CANCELED"
]));

function normalizeText(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || String(fallback || "").trim();
}

function errorMessage(error = null) {
  return normalizeText(error?.message || error?.cause?.message || error);
}

function errorCode(error = null) {
  return normalizeText(error?.code || error?.cause?.code).toUpperCase();
}

function errorName(error = null) {
  return normalizeText(error?.name || error?.cause?.name);
}

function normalizeRequestErrorStatus(error = null) {
  if (!isRecord(error)) {
    return null;
  }

  const hasStatus = Object.prototype.hasOwnProperty.call(error, "status");
  const hasStatusCode = Object.prototype.hasOwnProperty.call(error, "statusCode");
  if (!hasStatus && !hasStatusCode) {
    return null;
  }

  const status = Number(hasStatus ? error.status : error.statusCode);
  return Number.isInteger(status) ? status : null;
}

function isCanceledRequestError(error = null) {
  const name = errorName(error).toLowerCase();
  if (name === "aborterror" || name === "cancelederror") {
    return true;
  }
  return CANCELED_REQUEST_ERROR_CODES.has(errorCode(error));
}

function isRecoverableRequestError(error = null) {
  if (!error || isCanceledRequestError(error)) {
    return false;
  }

  const status = normalizeRequestErrorStatus(error);
  if (status === 0) {
    return true;
  }

  if (RECOVERABLE_REQUEST_ERROR_CODES.has(errorCode(error))) {
    return true;
  }

  const message = errorMessage(error);
  return Boolean(
    message &&
      RECOVERABLE_REQUEST_ERROR_MESSAGES.some((pattern) => pattern.test(message))
  );
}

function requestRecoveryMessage(error = null, {
  label = "Request",
  message = ""
} = {}) {
  const explicitMessage = normalizeText(message);
  if (explicitMessage) {
    return explicitMessage;
  }

  const requestLabel = normalizeText(label, "Request");
  if (requestLabel === "Request") {
    return "The app could not reach the server or network. Check the connection and try again.";
  }
  return `${requestLabel} could not reach the server or network. Check the connection and try again.`;
}

function resolveQueryMeta(query = null) {
  if (isRecord(query?.meta)) {
    return query.meta;
  }
  if (isRecord(query?.options?.meta)) {
    return query.options.meta;
  }
  return {};
}

function isRequestRecoveryDisabled(query = null) {
  const meta = resolveQueryMeta(query);
  if (meta.jskitRequestRecovery === false || meta.requestRecovery === false) {
    return true;
  }

  const jskitMeta = isRecord(meta.jskit) ? meta.jskit : {};
  return jskitMeta.requestRecovery === false;
}

function resolveQueryRecoveryLabel(query = null) {
  const meta = resolveQueryMeta(query);
  const jskitMeta = isRecord(meta.jskit) ? meta.jskit : {};

  return normalizeText(
    jskitMeta.requestRecoveryLabel ||
      jskitMeta.label ||
      meta.jskitRequestRecoveryLabel ||
      meta.requestRecoveryLabel ||
      meta.label,
    "Request"
  );
}

function isActiveQuery(query = null) {
  if (typeof query?.isActive === "function") {
    return Boolean(query.isActive());
  }
  if (typeof query?.getObserversCount === "function") {
    return Number(query.getObserversCount()) > 0;
  }
  return true;
}

function recoverableQueryError(query = null) {
  const state = isRecord(query?.state) ? query.state : {};
  if (state.status !== "error" || state.fetchStatus !== "idle") {
    return null;
  }

  const error = state.error || state.fetchFailureReason || null;
  return isRecoverableRequestError(error) ? error : null;
}

function createQueryRetry(queryClient, query = null) {
  if (!queryClient || typeof queryClient.refetchQueries !== "function") {
    return null;
  }

  const queryKey = query?.queryKey;
  if (!Array.isArray(queryKey)) {
    return null;
  }

  return () =>
    queryClient.refetchQueries(
      {
        queryKey,
        exact: true,
        type: "active"
      },
      {
        throwOnError: false
      }
    );
}

function resolveQueryHash(query = null) {
  const explicitHash = normalizeText(query?.queryHash);
  if (explicitHash) {
    return explicitHash;
  }

  try {
    return normalizeText(JSON.stringify(query?.queryKey || []));
  } catch {
    return normalizeText(String(query?.queryKey || ""));
  }
}

function installRecoverableQueryObserver({
  app,
  runtime,
  logger
} = {}) {
  if (!app?.has?.("jskit.client.query-client")) {
    return Object.freeze({
      dispose() {}
    });
  }

  const queryClient = app.make("jskit.client.query-client");
  const queryCache =
    queryClient && typeof queryClient.getQueryCache === "function"
      ? queryClient.getQueryCache()
      : null;
  if (!queryCache || typeof queryCache.subscribe !== "function") {
    return Object.freeze({
      dispose() {}
    });
  }

  const reportedErrorUpdateByQueryHash = new Map();

  function inspectQuery(query = null) {
    if (!query || isRequestRecoveryDisabled(query) || !isActiveQuery(query)) {
      return;
    }

    const error = recoverableQueryError(query);
    const queryHash = resolveQueryHash(query);
    if (!error || !queryHash) {
      reportedErrorUpdateByQueryHash.delete(queryHash);
      return;
    }

    const errorUpdateCount = Number(query?.state?.errorUpdateCount || 0);
    const reportKey = `${errorUpdateCount}:${errorMessage(error)}`;
    if (reportedErrorUpdateByQueryHash.get(queryHash) === reportKey) {
      return;
    }
    reportedErrorUpdateByQueryHash.set(queryHash, reportKey);

    runtime.report(error, {
      label: resolveQueryRecoveryLabel(query),
      retry: createQueryRetry(queryClient, query),
      source: "shell-web.request-recovery.query",
      stale: query?.state?.data !== undefined,
      dedupeKey: `shell-web.request-recovery.query.${queryHash}.${errorUpdateCount}`
    });
  }

  try {
    if (typeof queryCache.getAll === "function") {
      for (const query of queryCache.getAll()) {
        inspectQuery(query);
      }
    }
  } catch (error) {
    logger.warn(
      {
        error: errorMessage(error) || "unknown error"
      },
      "Shell request recovery could not inspect existing queries."
    );
  }

  const unsubscribe = queryCache.subscribe((event = {}) => {
    try {
      inspectQuery(event?.query);
    } catch (error) {
      logger.warn(
        {
          error: errorMessage(error) || "unknown error"
        },
        "Shell request recovery query observer failed."
      );
    }
  });

  return Object.freeze({
    dispose() {
      reportedErrorUpdateByQueryHash.clear();
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    }
  });
}

function createShellRequestRecoveryRuntime({
  app,
  logger = null
} = {}) {
  if (!app || typeof app.has !== "function" || typeof app.make !== "function") {
    throw new Error("createShellRequestRecoveryRuntime requires application has()/make().");
  }

  const runtimeLogger = logger || createSharedProviderLogger(app);
  let installedQueryObserver = null;
  let reloadAttempt = 0;

  function errorRuntime() {
    if (!app.has("runtime.web-error.client")) {
      return null;
    }
    const runtime = app.make("runtime.web-error.client");
    return runtime && typeof runtime.report === "function" ? runtime : null;
  }

  async function reload({
    label = "App",
    message = REQUEST_RECOVERY_RELOAD_FAILURE_MESSAGE
  } = {}) {
    const reloaded = await guardedReloadApp({
      label,
      message
    });
    if (!reloaded) {
      reloadAttempt += 1;
      report(new Error("Network request failed."), {
        label,
        message,
        reload: true,
        force: true,
        source: "shell-web.request-recovery.reload",
        dedupeKey: `shell-web.request-recovery.reload.${reloadAttempt}`
      });
    }
    return reloaded;
  }

  function retryAction(error, options, retry) {
    return {
      label: normalizeText(options.actionLabel, "Retry"),
      dismissOnRun: true,
      async handler() {
        try {
          return await retry();
        } catch (retryError) {
          if (isRecoverableRequestError(retryError)) {
            return report(retryError, options);
          }
          throw retryError;
        }
      }
    };
  }

  function reloadAction(options) {
    return {
      label: normalizeText(options.actionLabel, "Reload"),
      dismissOnRun: true,
      handler() {
        return reload({
          label: options.label,
          message: options.reloadFailureMessage || REQUEST_RECOVERY_RELOAD_FAILURE_MESSAGE
        });
      }
    };
  }

  function report(error = null, options = {}) {
    if (!isRecoverableRequestError(error) && options.force !== true) {
      return null;
    }

    const runtime = errorRuntime();
    const source = normalizeText(options.source, "shell-web.request-recovery");
    if (!runtime) {
      runtimeLogger.warn(
        {
          source,
          error: errorMessage(error) || "unknown error"
        },
        "Shell request recovery could not report because the shell error runtime is unavailable."
      );
      return null;
    }

    const retry = typeof options.retry === "function" ? options.retry : null;
    const action = retry
      ? retryAction(error, options, retry)
      : options.reload === true
        ? reloadAction(options)
        : null;

    try {
      return runtime.report({
        source,
        message: requestRecoveryMessage(error, options),
        cause: error || null,
        intent: "app-recoverable",
        severity: normalizeText(options.severity, options.stale ? "warning" : "error"),
        dedupeKey: normalizeText(options.dedupeKey),
        dedupeWindowMs: Number.isFinite(Number(options.dedupeWindowMs))
          ? Math.max(0, Number(options.dedupeWindowMs))
          : 2000,
        action
      });
    } catch (reportError) {
      runtimeLogger.error(
        {
          source,
          error: errorMessage(reportError) || "unknown error"
        },
        "Shell request recovery could not report through the shell error runtime."
      );
      return null;
    }
  }

  function install() {
    if (installedQueryObserver) {
      return installedQueryObserver;
    }

    installedQueryObserver = installRecoverableQueryObserver({
      app,
      runtime: api,
      logger: runtimeLogger
    });
    return installedQueryObserver;
  }

  function dispose() {
    installedQueryObserver?.dispose?.();
    installedQueryObserver = null;
  }

  const api = Object.freeze({
    dispose,
    install,
    isRecoverableRequestError,
    reload,
    report
  });

  return api;
}

export {
  createShellRequestRecoveryRuntime,
  isRecoverableRequestError,
  requestRecoveryMessage
};
