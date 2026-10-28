import { guardedReloadApp } from "@jskit-ai/kernel/client/asyncModuleRecovery";
import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createProviderLogger as createSharedProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";
import { useJskitText } from "../i18n.js";

const { t, text } = useJskitText();
// The label callers passed before labels were translated; it still means "no label".
const GENERIC_REQUEST_LABEL = "Request";

function appReloadFailureMessage() {
  return t("jskit.shell.recovery.reloadFailed");
}

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

const SAFE_REQUEST_RECOVERY_METHODS = Object.freeze(new Set([
  "GET",
  "HEAD"
]));

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

// The label may be a message key; without one the sentence names the app.
function requestRecoveryMessage(error = null, {
  label = "",
  message = ""
} = {}) {
  const explicitMessage = normalizeText(message);
  if (explicitMessage) {
    return explicitMessage;
  }

  const requestLabel = normalizeText(text(label));
  if (!requestLabel || requestLabel === GENERIC_REQUEST_LABEL) {
    return t("jskit.shell.recovery.appUnreachable");
  }
  return t("jskit.shell.recovery.unreachable", { label: requestLabel });
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

function readQueryRecoveryMeta(query = null) {
  const meta = resolveQueryMeta(query);
  const jskitMeta = isRecord(meta.jskit) ? meta.jskit : {};
  const dedupeWindowMs = jskitMeta.requestRecoveryDedupeWindowMs;

  return Object.freeze({
    disabled: jskitMeta.requestRecovery === false,
    label: normalizeText(jskitMeta.requestRecoveryLabel),
    source: normalizeText(jskitMeta.requestRecoverySource, { fallback: "shell-web.request-recovery.query" }),
    dedupeKey: normalizeText(jskitMeta.requestRecoveryDedupeKey),
    dedupeWindowMs: Number.isFinite(Number(dedupeWindowMs)) ? Math.max(0, Number(dedupeWindowMs)) : null,
    method: normalizeText(jskitMeta.requestRecoveryMethod).toUpperCase()
  });
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
  queryClient,
  runtime,
  logger
} = {}) {
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

  function dismissReportedQueryRecovery(queryHash = "") {
    const reported = reportedErrorUpdateByQueryHash.get(queryHash);
    if (!reported) {
      return;
    }

    reportedErrorUpdateByQueryHash.delete(queryHash);
    if (reported.presentationId && typeof runtime.dismiss === "function") {
      runtime.dismiss(reported.presentationId, {
        presenterId: reported.presenterId
      });
    }
  }

  function dismissReportedQueryRecoveries() {
    for (const queryHash of [...reportedErrorUpdateByQueryHash.keys()]) {
      dismissReportedQueryRecovery(queryHash);
    }
  }

  function inspectQuery(query = null) {
    const queryHash = resolveQueryHash(query);
    const recoveryMeta = readQueryRecoveryMeta(query);
    if (
      !query ||
      recoveryMeta.disabled ||
      !SAFE_REQUEST_RECOVERY_METHODS.has(recoveryMeta.method) ||
      !isActiveQuery(query)
    ) {
      if (queryHash) {
        dismissReportedQueryRecovery(queryHash);
      }
      return;
    }

    const error = recoverableQueryError(query);
    if (!error || !queryHash) {
      if (queryHash) {
        dismissReportedQueryRecovery(queryHash);
      }
      return;
    }

    const errorUpdateCount = Number(query?.state?.errorUpdateCount || 0);
    const reportKey = `${errorUpdateCount}:${errorMessage(error)}`;
    const reported = reportedErrorUpdateByQueryHash.get(queryHash);
    if (reported?.reportKey === reportKey) {
      return;
    }

    const { dedupeWindowMs } = recoveryMeta;
    const result = runtime.report(error, {
      label: recoveryMeta.label,
      retry: createQueryRetry(queryClient, query),
      source: recoveryMeta.source,
      stale: query?.state?.data !== undefined,
      dedupeKey: recoveryMeta.dedupeKey || `shell-web.request-recovery.query.${queryHash}.${errorUpdateCount}`,
      ...(dedupeWindowMs !== null ? { dedupeWindowMs } : {})
    });

    const presentationId = normalizeText(result?.presentationId || reported?.presentationId);
    const presenterId = normalizeText(result?.decision?.presenterId || reported?.presenterId);
    if (reported?.presentationId && reported.presentationId !== presentationId) {
      dismissReportedQueryRecovery(queryHash);
    }
    reportedErrorUpdateByQueryHash.set(queryHash, {
      reportKey,
      presentationId,
      presenterId
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
      dismissReportedQueryRecoveries();
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    }
  });
}

function createShellRequestRecoveryRuntime({
  queryClient = null,
  errorRuntime = null,
  logger = null
} = {}) {
  const runtimeLogger = createSharedProviderLogger(logger);
  let installedQueryObserver = null;
  let reloadAttempt = 0;

  async function reload({
    label = t("jskit.shell.recovery.appLabel"),
    message = appReloadFailureMessage()
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

  function retryAction(options, retry) {
    return {
      label: normalizeText(text(options.actionLabel), { fallback: t("jskit.shell.actions.retry") }),
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
      label: normalizeText(text(options.actionLabel), { fallback: t("jskit.shell.actions.reload") }),
      dismissOnRun: true,
      handler() {
        return reload({
          label: options.label,
          message: options.reloadFailureMessage || appReloadFailureMessage()
        });
      }
    };
  }

  function dismiss(presentationId = "", options = {}) {
    if (!errorRuntime || typeof errorRuntime.dismiss !== "function") {
      return 0;
    }
    return errorRuntime.dismiss(presentationId, options);
  }

  function report(error = null, options = {}) {
    if (!isRecoverableRequestError(error) && options.force !== true) {
      return null;
    }

    const source = normalizeText(options.source, { fallback: "shell-web.request-recovery" });
    if (!errorRuntime || typeof errorRuntime.report !== "function") {
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
      ? retryAction(options, retry)
      : options.reload === true
        ? reloadAction(options)
        : null;

    try {
      return errorRuntime.report({
        source,
        message: requestRecoveryMessage(error, options),
        cause: error || null,
        intent: "app-recoverable",
        severity: normalizeText(options.severity, { fallback: options.stale ? "warning" : "error" }),
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
      queryClient,
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
    dismiss,
    dispose,
    install,
    isRecoverableRequestError,
    reload,
    report
  });

  return api;
}

export {
  appReloadFailureMessage,
  createShellRequestRecoveryRuntime,
  isRecoverableRequestError,
  requestRecoveryMessage
};
