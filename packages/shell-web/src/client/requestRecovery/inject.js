import { inject } from "vue";
import { isRecoverableRequestError } from "./runtime.js";

const SHELL_REQUEST_RECOVERY_RUNTIME_KEY =
  "jskit.shell-web.runtime.web-request-recovery.client";

/**
 * The recovery of an application without shell-web's provider: nothing is reported and nothing reloads.
 * @type {import("../types.js").ShellRequestRecoveryRuntime}
 */
const NO_SHELL_REQUEST_RECOVERY_RUNTIME = Object.freeze({
  dismiss() {
    return 0;
  },
  dispose() {},
  install() {
    return Object.freeze({
      dispose() {}
    });
  },
  isRecoverableRequestError,
  async reload() {
    return false;
  },
  report() {
    return null;
  }
});

/**
 * The shell's request recovery, or `NO_SHELL_REQUEST_RECOVERY_RUNTIME` in an application without shell-web's provider.
 * @returns {import("../types.js").ShellRequestRecoveryRuntime}
 */
function useShellRequestRecoveryRuntime() {
  return inject(SHELL_REQUEST_RECOVERY_RUNTIME_KEY, NO_SHELL_REQUEST_RECOVERY_RUNTIME);
}

export {
  NO_SHELL_REQUEST_RECOVERY_RUNTIME,
  SHELL_REQUEST_RECOVERY_RUNTIME_KEY,
  useShellRequestRecoveryRuntime
};
