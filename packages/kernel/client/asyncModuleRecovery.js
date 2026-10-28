import { isRecord } from "../shared/support/normalize.js";

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
    retry: typeof retry === "function" ? retry : null,
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
  state.retry = typeof retry === "function" ? retry : null;
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

async function guardedReloadApp({
  browserWindow = typeof window !== "undefined" ? window : null,
  fetchFn = typeof fetch === "function" ? fetch : null,
  state = null,
  label = "App",
  message = RELOAD_UNAVAILABLE.message,
  messageCode = message === RELOAD_UNAVAILABLE.message ? RELOAD_UNAVAILABLE.messageCode : "",
  messageParams = {}
} = {}) {
  if (!browserWindow?.location) {
    return false;
  }
  if (typeof fetchFn !== "function") {
    browserWindow.location.reload();
    return true;
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

function installAsyncModuleRecoveryHandlers({
  router = null,
  state,
  label = "App module",
  onNotify = null,
  windowObject = typeof window !== "undefined" ? window : null
} = {}) {
  if (!isRecord(state)) {
    throw new TypeError("installAsyncModuleRecoveryHandlers requires a mutable recovery state object.");
  }

  const disposers = [];
  const notify = typeof onNotify === "function" ? onNotify : () => null;

  if (router && typeof router.onError === "function") {
    const removeRouterHandler = router.onError((error, to = {}) => {
      if (!isDynamicImportError(error)) {
        return;
      }

      const fullPath = String(to?.fullPath || "");
      notifyAsyncModuleLoadError(state, error, {
        label: "Page",
        retry: fullPath && typeof router.replace === "function"
          ? () => router.replace(fullPath)
          : null,
        stale: true
      });
      notify(state);
    });
    if (typeof removeRouterHandler === "function") {
      disposers.push(removeRouterHandler);
    }
  }

  if (windowObject && typeof windowObject.addEventListener === "function") {
    const handler = (event) => {
      const error = event?.reason;
      if (!isDynamicImportError(error)) {
        return;
      }
      notifyAsyncModuleLoadError(state, error, {
        label,
        stale: true
      });
      notify(state);
    };
    windowObject.addEventListener("unhandledrejection", handler);
    disposers.push(() => {
      windowObject.removeEventListener?.("unhandledrejection", handler);
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
