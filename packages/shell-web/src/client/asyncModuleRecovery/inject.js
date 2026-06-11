import {
  hasInjectionContext,
  inject
} from "vue";

const SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY =
  "jskit.shell-web.runtime.web-async-module-recovery.client";

function isShellAsyncModuleRecoveryRuntime(value) {
  return Boolean(
    value &&
      typeof value.notify === "function" &&
      typeof value.reload === "function"
  );
}

function useShellAsyncModuleRecoveryRuntime() {
  if (!hasInjectionContext()) {
    return null;
  }

  const runtime = inject(SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY, null);
  return isShellAsyncModuleRecoveryRuntime(runtime) ? runtime : null;
}

export {
  SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY,
  isShellAsyncModuleRecoveryRuntime,
  useShellAsyncModuleRecoveryRuntime
};
