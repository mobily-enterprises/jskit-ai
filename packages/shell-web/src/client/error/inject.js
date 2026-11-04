import { inject } from "vue";
import { normalizeErrorEvent } from "./runtime.js";

const SHELL_WEB_ERROR_RUNTIME_KEY = "jskit.shell-web.runtime.web-error.client";

function throwUnavailable() {
  throw new Error("Shell web error runtime is not available.");
}

function emptySnapshot() {
  return Object.freeze({
    presenterIds: Object.freeze([]),
    appDefaultPresenterId: "",
    moduleDefaultPresenterId: "",
    resolvedDefaultPresenterId: ""
  });
}

/**
 * The error runtime of an application without shell-web's provider: a report is skipped and nothing can be set up.
 * @type {any}
 */
const NO_SHELL_WEB_ERROR_RUNTIME = Object.freeze({
  report() {
    return Object.freeze({
      skipped: true,
      reason: "unavailable"
    });
  },
  dismiss() {
    return 0;
  },
  configure: emptySnapshot,
  registerPresenter: throwUnavailable,
  registerPresenters: throwUnavailable,
  setPolicy: throwUnavailable,
  setAppDefaultPresenterId: throwUnavailable,
  assertBootReady: throwUnavailable,
  getSnapshot: emptySnapshot,
  subscribe() {
    return () => {};
  },
  normalizeErrorEvent
});

/**
 * The shell's error runtime, or `NO_SHELL_WEB_ERROR_RUNTIME` in an application without shell-web's provider.
 * @returns {import("../types.js").ShellErrorRuntime}
 */
function useShellWebErrorRuntime() {
  return inject(SHELL_WEB_ERROR_RUNTIME_KEY, NO_SHELL_WEB_ERROR_RUNTIME);
}

export {
  NO_SHELL_WEB_ERROR_RUNTIME,
  SHELL_WEB_ERROR_RUNTIME_KEY,
  useShellWebErrorRuntime
};
