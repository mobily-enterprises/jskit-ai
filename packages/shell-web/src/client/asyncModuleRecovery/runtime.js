import {
  createAsyncModuleRecoveryState,
  guardedReloadApp,
  installAsyncModuleRecoveryHandlers,
  isDynamicImportError,
  notifyAsyncModuleLoadError
} from "@jskit-ai/kernel/client/asyncModuleRecovery";
import { appReloadFailureMessage } from "../requestRecovery/runtime.js";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

/**
 * @param {object} options
 * @param {import("@jskit-ai/kernel/client/types").ClientRouter} options.router
 * @param {import("../types.js").ShellErrorRuntime} options.errorRuntime
 * @param {import("@jskit-ai/kernel/client/types").ClientLogger} options.logger
 */
function createShellAsyncModuleRecoveryRuntime({
  router,
  errorRuntime,
  logger
}) {
  const state = createAsyncModuleRecoveryState();
  let installedRecovery = null;

  function report(nextState = state) {
    try {
      return errorRuntime.report({
        source: "shell-web.async-module-recovery",
        message: String(nextState.message || t("jskit.shell.recovery.moduleFailed")),
        // The kernel's sentence for this failure, so the whole message is translated.
        ...(nextState.message && nextState.messageCode
          ? { messageCode: nextState.messageCode, messageParams: nextState.messageParams }
          : {}),
        cause: nextState.error || null,
        intent: "app-recoverable",
        severity: "warning",
        dedupeKey: `shell-web.async-module-recovery.${Number(nextState.attempt || 0)}`,
        action: {
          label: t("jskit.shell.actions.reload"),
          dismissOnRun: true,
          handler() {
            return reload();
          }
        }
      });
    } catch (error) {
      logger.error(
        {
          label: String(nextState.label || ""),
          error: String(error?.message || error || "unknown error")
        },
        "Async module recovery could not report through the shell error runtime."
      );
      return null;
    }
  }

  async function reload() {
    const reloaded = await guardedReloadApp({
      state,
      label: t("jskit.shell.recovery.appLabel"),
      message: appReloadFailureMessage()
    });
    if (!reloaded) {
      report(state);
    }
    return reloaded;
  }

  function notify(error = null, {
    label = t("jskit.shell.recovery.appModuleLabel"),
    message = "",
    stale = isDynamicImportError(error)
  } = {}) {
    notifyAsyncModuleLoadError(state, error, {
      label,
      message,
      retry: state.retry,
      stale
    });
    return report(state);
  }

  function install() {
    if (installedRecovery) {
      return installedRecovery;
    }

    installedRecovery = installAsyncModuleRecoveryHandlers({
      state,
      label: t("jskit.shell.recovery.appModuleLabel"),
      router,
      onNotify: report
    });
    return installedRecovery;
  }

  function dispose() {
    if (installedRecovery) {
      installedRecovery.dispose();
      installedRecovery = null;
    }
  }

  return Object.freeze({
    dispose,
    install,
    notify,
    reload,
    report,
    state
  });
}

export {
  createShellAsyncModuleRecoveryRuntime
};
