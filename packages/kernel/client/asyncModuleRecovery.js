import { isRecord } from "../shared/support/normalize.js";
import { pageWindow } from "./browser.js";

const DYNAMIC_IMPORT_ERROR_PATTERNS = Object.freeze([
  /ChunkLoadError/iu,
  /Failed to fetch dynamically imported module/iu,
  /Importing a module script failed/iu,
  /error loading dynamically imported module/iu,
  /Loading chunk .+ failed/iu,
  /Unable to preload CSS/iu
]);

function errorText(error = null) {
  return String(error?.message || error || "").trim();
}

function isDynamicImportError(error = null) {
  const text = errorText(error);
  return Boolean(text && DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) => pattern.test(text)));
}

const RELOAD_UNAVAILABLE = Object.freeze({
  message: "The app cannot reload because the app server is not reachable. Restart the server, then click Retry or Reload.",
  messageCode: "kernel.moduleLoad.reloadUnavailable"
});

// The built-in labels have whole sentences of their own, so a translation never
// has to splice an English label into its sentence.
const BUILT_IN_LABEL_MESSAGE_CODES = Object.freeze({
  "App module": Object.freeze({
    stale: { messageCode: "kernel.moduleLoad.appModuleNotDownloaded" },
    failed: { messageCode: "kernel.moduleLoad.appModuleFailed" }
  }),
  Page: Object.freeze({
    stale: { messageCode: "kernel.moduleLoad.pageNotDownloaded" },
    failed: { messageCode: "kernel.moduleLoad.pageFailed" }
  })
});

function dynamicImportErrorMessage(error = null, {
  label = "App module",
  stale = isDynamicImportError(error)
} = {}) {
  const moduleLabel = String(label || "App module").trim();
  if (stale) {
    return `${moduleLabel} did not download. The app may have been updated, or the network request failed.`;
  }
  return `${moduleLabel} could not load.`;
}

// The messageCode and messageParams of dynamicImportErrorMessage's sentence.
function dynamicImportErrorMessageCode(label, stale) {
  const builtIn = Object.hasOwn(BUILT_IN_LABEL_MESSAGE_CODES, label) ? BUILT_IN_LABEL_MESSAGE_CODES[label] : null;
  if (builtIn) {
    return { ...(stale ? builtIn.stale : builtIn.failed), messageParams: {} };
  }
  return stale
    ? { messageCode: "kernel.moduleLoad.notDownloaded", messageParams: { label } }
    : { messageCode: "kernel.moduleLoad.failed", messageParams: { label } };
}

function createAsyncModuleRecoveryState({
  label = "App module",
  message = "",
  retry = null
} = {}) {
  return {
    attempt: 0,
    error: null,
    label: String(label || "App module").trim(),
    message: String(message || "").trim(),
    messageCode: "",
    messageParams: {},
    retry,
    stale: false,
    visible: false
  };
}

// state.message is the English; state.messageCode and messageParams render it in the
// user's language. A caller's own message has a code only when it passes one.
function notifyAsyncModuleLoadError(state, error = null, {
  label = "App module",
  message = "",
  messageCode = "",
  messageParams = {},
  retry = null,
  stale = isDynamicImportError(error)
} = {}) {
  if (!isRecord(state)) {
    throw new TypeError("notifyAsyncModuleLoadError requires a mutable recovery state object.");
  }

  const normalizedLabel = String(label || "App module").trim();
  const callerMessage = String(message || "").trim();
  const coded = callerMessage
    ? { messageCode: String(messageCode || "").trim(), messageParams: isRecord(messageParams) ? messageParams : {} }
    : dynamicImportErrorMessageCode(normalizedLabel, Boolean(stale));
  state.attempt = Number(state.attempt || 0) + 1;
  state.error = error || null;
  state.label = normalizedLabel;
  state.message = callerMessage ||
    dynamicImportErrorMessage(error, {
      label: normalizedLabel,
      stale
    });
  state.messageCode = coded.messageCode;
  state.messageParams = coded.messageParams;
  state.retry = retry;
  state.stale = Boolean(stale);
  state.visible = true;
  return state;
}

function dismissAsyncModuleRecovery(state) {
  if (!isRecord(state)) {
    return false;
  }

  state.visible = false;
  return true;
}

/**
 * Reloads the page once the server answers for it; until then the page stays, and state shows why.
 * @param {object} [options]
 * @param {Window | null} [options.browserWindow] The page's window; without one there is nothing to reload.
 * @param {typeof fetch} [options.fetchFn]
 * @param {import("./types.js").AsyncModuleRecoveryState | null} [options.state]
 * @param {string} [options.label]
 * @param {string} [options.message]
 * @param {string} [options.messageCode]
 * @param {Record<string, unknown>} [options.messageParams]
 */
async function guardedReloadApp({
  browserWindow = pageWindow(),
  fetchFn = globalThis.fetch,
  state = null,
  label = "App",
  message = RELOAD_UNAVAILABLE.message,
  messageCode = message === RELOAD_UNAVAILABLE.message ? RELOAD_UNAVAILABLE.messageCode : "",
  messageParams = {}
} = {}) {
  if (!browserWindow?.location) {
    return false;
  }

  try {
    const response = await fetchFn(String(browserWindow.location.href || "/"), {
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      method: "GET"
    });
    if (!response?.ok) {
      throw new Error(`Reload check failed with HTTP ${response?.status || 0}.`);
    }
    browserWindow.location.reload();
    return true;
  } catch (error) {
    if (state) {
      notifyAsyncModuleLoadError(state, error, {
        label,
        message,
        messageCode,
        messageParams,
        retry: state.retry,
        stale: false
      });
    }
    return false;
  }
}

/**
 * Notifies state of a dynamic import that failed in a navigation or as an unhandled rejection, until disposed.
 * @param {object} options
 * @param {import("./types.js").ClientRouter} options.router
 * @param {import("./types.js").AsyncModuleRecoveryState} options.state
 * @param {string} [options.label]
 * @param {(state: import("./types.js").AsyncModuleRecoveryState) => void} options.onNotify
 * @param {Window | null} [options.windowObject] The page's window; outside a browser only the router is watched.
 */
function installAsyncModuleRecoveryHandlers({
  router,
  state,
  label = "App module",
  onNotify,
  windowObject = pageWindow()
}) {
  if (!isRecord(state)) {
    throw new TypeError("installAsyncModuleRecoveryHandlers requires a mutable recovery state object.");
  }

  const disposers = [];

  disposers.push(router.onError((error, to) => {
    if (!isDynamicImportError(error)) {
      return;
    }

    const fullPath = String(to.fullPath || "");
    notifyAsyncModuleLoadError(state, error, {
      label: "Page",
      retry: fullPath ? () => router.replace(fullPath) : null,
      stale: true
    });
    onNotify(state);
  }));

  if (windowObject) {
    const handler = (event) => {
      const error = event?.reason;
      if (!isDynamicImportError(error)) {
        return;
      }
      notifyAsyncModuleLoadError(state, error, {
        label,
        stale: true
      });
      onNotify(state);
    };
    windowObject.addEventListener("unhandledrejection", handler);
    disposers.push(() => {
      windowObject.removeEventListener("unhandledrejection", handler);
    });
  }

  return Object.freeze({
    dispose() {
      for (const dispose of disposers.splice(0)) {
        dispose();
      }
    }
  });
}

export {
  createAsyncModuleRecoveryState,
  dismissAsyncModuleRecovery,
  dynamicImportErrorMessage,
  guardedReloadApp,
  installAsyncModuleRecoveryHandlers,
  isDynamicImportError,
  notifyAsyncModuleLoadError
};
