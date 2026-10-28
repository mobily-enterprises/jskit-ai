import { isRecord } from "@jskit-ai/kernel/shared/support";
import { createProviderLogger as createSharedProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

const SHELL_WEB_REFRESH_RUNTIME_KEY = "jskit.shell-web.runtime.web-refresh.client";

function isPullRefreshQuery(query = null) {
  const meta = isRecord(query?.meta) ? query.meta : {};
  if (meta.jskitRefresh === "pull") {
    return true;
  }
  if (meta.jskitRefresh === false) {
    return false;
  }

  const jskitMeta = isRecord(meta.jskit) ? meta.jskit : {};
  return jskitMeta.refreshOnPull !== false;
}

function createShellRefreshRuntime({
  bootstrapRuntime = null,
  queryClient = null,
  errorRuntime = null,
  logger = null
} = {}) {
  const runtimeLogger = createSharedProviderLogger(logger);
  let refreshQueue = Promise.resolve(null);

  async function refreshBootstrap(reason) {
    if (!bootstrapRuntime || typeof bootstrapRuntime.refresh !== "function") {
      return false;
    }

    await bootstrapRuntime.refresh(reason);
    return true;
  }

  async function refetchPullQueries() {
    if (!queryClient || typeof queryClient.refetchQueries !== "function") {
      return false;
    }

    await queryClient.refetchQueries(
      {
        type: "active",
        predicate: isPullRefreshQuery
      },
      {
        throwOnError: false
      }
    );
    return true;
  }

  function reportRefreshFailure(error) {
    runtimeLogger.warn(
      {
        error: String(error?.message || error || "unknown error")
      },
      "Shell refresh failed."
    );

    if (!errorRuntime || typeof errorRuntime.report !== "function") {
      return;
    }

    errorRuntime.report({
      source: "shell-web.refresh",
      message: t("jskit.shell.recovery.refreshFailed"),
      intent: "app-recoverable",
      severity: "error",
      dedupeKey: "shell-web.refresh.failed",
      dedupeWindowMs: 2000,
      action: {
        label: t("jskit.shell.actions.retry"),
        dismissOnRun: true,
        handler() {
          void refresh("retry");
        }
      }
    });
  }

  async function performRefresh(reason = "manual") {
    const normalizedReason = String(reason || "manual").trim() || "manual";
    try {
      const [bootstrapRefreshed, queriesRefetched] = await Promise.all([
        refreshBootstrap(normalizedReason),
        refetchPullQueries()
      ]);

      return Object.freeze({
        reason: normalizedReason,
        bootstrapRefreshed,
        queriesRefetched
      });
    } catch (error) {
      reportRefreshFailure(error);
      return Object.freeze({
        reason: normalizedReason,
        bootstrapRefreshed: false,
        queriesRefetched: false,
        error
      });
    }
  }

  function refresh(reason = "manual") {
    refreshQueue = refreshQueue
      .catch(() => null)
      .then(() => performRefresh(reason));
    return refreshQueue;
  }

  return Object.freeze({
    refresh
  });
}

export {
  SHELL_WEB_REFRESH_RUNTIME_KEY,
  createShellRefreshRuntime
};
