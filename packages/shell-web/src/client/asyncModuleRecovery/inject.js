import { inject } from "vue";
import { createAsyncModuleRecoveryState } from "@jskit-ai/kernel/client/asyncModuleRecovery";

const SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY =
  "jskit.shell-web.runtime.web-async-module-recovery.client";

/**
 * The recovery of an application without shell-web's provider: nothing is reported and nothing reloads.
 * @type {import("../types.js").ShellAsyncModuleRecoveryRuntime}
 */
const NO_SHELL_ASYNC_MODULE_RECOVERY_RUNTIME = Object.freeze({
  dispose() {},
  install() {
    return Object.freeze({
      dispose() {}
    });
  },
  notify() {
    return null;
  },
  async reload() {
    return false;
  },
  report() {
    return null;
  },
  state: Object.freeze(createAsyncModuleRecoveryState())
});

/**
 * The shell's module recovery, or `NO_SHELL_ASYNC_MODULE_RECOVERY_RUNTIME` in an application without shell-web's provider.
 * @returns {import("../types.js").ShellAsyncModuleRecoveryRuntime}
 */
function useShellAsyncModuleRecoveryRuntime() {
  return inject(SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY, NO_SHELL_ASYNC_MODULE_RECOVERY_RUNTIME);
}

export {
  NO_SHELL_ASYNC_MODULE_RECOVERY_RUNTIME,
  SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY,
  useShellAsyncModuleRecoveryRuntime
};
