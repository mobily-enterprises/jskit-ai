import {
  hasInjectionContext,
  inject
} from "vue";

const SHELL_REQUEST_RECOVERY_RUNTIME_KEY =
  "jskit.shell-web.runtime.web-request-recovery.client";

function isShellRequestRecoveryRuntime(value) {
  return Boolean(
    value &&
      typeof value.report === "function" &&
      typeof value.reload === "function"
  );
}

function useShellRequestRecoveryRuntime() {
  if (!hasInjectionContext()) {
    return null;
  }

  const runtime = inject(SHELL_REQUEST_RECOVERY_RUNTIME_KEY, null);
  return isShellRequestRecoveryRuntime(runtime) ? runtime : null;
}

export {
  SHELL_REQUEST_RECOVERY_RUNTIME_KEY,
  isShellRequestRecoveryRuntime,
  useShellRequestRecoveryRuntime
};
