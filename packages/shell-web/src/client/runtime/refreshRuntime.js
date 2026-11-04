import { isRecord } from "@jskit-ai/kernel/shared/support";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

const SHELL_WEB_REFRESH_RUNTIME_KEY = "jskit.shell-web.runtime.web-refresh.client";

/**
 * The refresh of an application without shell-web's provider: nothing refreshes, so pull-to-refresh never starts.
 * @type {any}
 */
const NO_SHELL_WEB_REFRESH_RUNTIME = Object.freeze({
  async refresh(reason = "manual") {
    return Object.freeze({
      reason,
      bootstrapRefreshed: false,
      queriesRefetched: false
    });
  }
});

function isPullRefreshQuery(query) {
  const meta = isRecord(query.meta) ? query.meta : {};
  if (meta.jskitRefresh === "pull") {
    return true;
  }
  if (meta.jskitRefresh === false) {
    return false;
  }

  const jskitMeta = isRecord(meta.jskit) ? meta.jskit : {};
  return jskitMeta.refreshOnPull !== false;
}

/**
 * @param {object} options
 * @param {import("../types.js").ShellBootstrapRuntime} options.bootstrapRuntime
 * @param {import("@jskit-ai/kernel/client/types").ClientQueryClient} options.queryClient
 * @param {import("../types.js").ShellErrorRuntime} options.errorRuntime
 * @param {import("@jskit-ai/kernel/client/types").ClientLogger} options.logger
 */
function createShellRefreshRuntime({
  bootstrapRuntime,
  queryClient,
  errorRuntime,
  logger
}) {
  let refreshQueue = Promise.resolve(null);

  async function refreshBootstrap(reason) {
    await bootstrapRuntime.refresh(reason);
    return true;
  }

  async function refetchPullQueries() {
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
    logger.warn(
      {
        error: String(error?.message || error || "unknown error")
      },
      "Shell refresh failed."
    );

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
  NO_SHELL_WEB_REFRESH_RUNTIME,
  SHELL_WEB_REFRESH_RUNTIME_KEY,
  createShellRefreshRuntime
};
