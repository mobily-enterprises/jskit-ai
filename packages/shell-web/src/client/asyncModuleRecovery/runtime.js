import {
  createAsyncModuleRecoveryState,
  guardedReloadApp,
  installAsyncModuleRecoveryHandlers,
  isDynamicImportError,
  notifyAsyncModuleLoadError
} from "@jskit-ai/kernel/client/asyncModuleRecovery";
import { createProviderLogger as createSharedProviderLogger } from "@jskit-ai/kernel/shared/support/providerLogger";
import { APP_RELOAD_FAILURE_MESSAGE } from "../requestRecovery/runtime.js";

function createShellAsyncModuleRecoveryRuntime({
  router = null,
  errorRuntime = null,
  logger = null
} = {}) {
  const runtimeLogger = createSharedProviderLogger(logger);
  const state = createAsyncModuleRecoveryState();
  let installedRecovery = null;

  function report(nextState = state) {
    if (!errorRuntime || typeof errorRuntime.report !== "function") {
      runtimeLogger.warn(
        {
          label: String(nextState?.label || "")
        },
        "Async module recovery could not report because the shell error runtime is unavailable."
      );
      return null;
    }

    try {
      return errorRuntime.report({
        source: "shell-web.async-module-recovery",
        message: String(nextState?.message || "A required app module could not load."),
        cause: nextState?.error || null,
        intent: "app-recoverable",
        severity: "warning",
        dedupeKey: `shell-web.async-module-recovery.${Number(nextState?.attempt || 0)}`,
        action: {
          label: "Reload",
          dismissOnRun: true,
          handler() {
            return reload();
          }
        }
      });
    } catch (error) {
      runtimeLogger.error(
        {
          label: String(nextState?.label || ""),
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
      label: "App",
      message: APP_RELOAD_FAILURE_MESSAGE
    });
    if (!reloaded) {
      report(state);
    }
    return reloaded;
  }

  function notify(error = null, {
    label = "App module",
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
      label: "App module",
      router,
      onNotify: report
    });
    return installedRecovery;
  }

  function dispose() {
    installedRecovery?.dispose?.();
    installedRecovery = null;
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
