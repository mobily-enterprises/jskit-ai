import { resolveMobileConfig } from "@jskit-ai/kernel/client";
import { registerMobileLaunchRouting } from "./mobileLaunchRouting.js";

/** The placement runtime of an application without a shell: there is no placement context. */
const NO_PLACEMENT_RUNTIME = Object.freeze({
  getContext() {
    return null;
  }
});

/** The callback completer of an application without auth: nothing completes, so the link routes as it came. */
const NO_AUTH_CALLBACK_COMPLETER = Object.freeze({
  async completeFromUrl() {
    return {
      completed: false
    };
  }
});

/** The guard of an application without auth: nothing to wait for, refresh or read. */
const NO_AUTH_GUARD_RUNTIME = Object.freeze({
  async initialize() {
    return null;
  },
  async refresh() {
    return null;
  },
  getState() {
    return {
      oauthDefaultProvider: ""
    };
  }
});

function extractPathname(value = "") {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return "";
  }

  try {
    const parsed = new URL(normalizedValue, "https://jskit.invalid");
    return String(parsed.pathname || "").trim();
  } catch {
    return "";
  }
}

function isAuthCallbackTargetPath(targetPath, mobileConfig) {
  const callbackPath = String(mobileConfig.auth.callbackPath || "").trim();
  if (!callbackPath) {
    return false;
  }

  return extractPathname(targetPath) === callbackPath;
}

/**
 * @param {object} options
 * @param {import("../types.js").ClientRouter} options.router
 * @param {object} options.mobileConfig The application's `config.mobile`.
 * @param {import("../types.js").CapacitorAppAdapter} options.adapter
 * @param {import("../types.js").MobilePlacementRuntime} [options.placementRuntime] Absent without a shell.
 * @param {import("../types.js").MobileAuthCallbackCompleter} [options.authCallbackCompleter] Absent without auth.
 * @param {import("../types.js").MobileAuthGuardRuntime} [options.authGuardRuntime] Absent without auth.
 * @param {import("../types.js").MobileLaunchLogger} [options.logger]
 */
function createMobileCapacitorRuntime({
  router,
  mobileConfig,
  adapter,
  placementRuntime = NO_PLACEMENT_RUNTIME,
  authCallbackCompleter = NO_AUTH_CALLBACK_COMPLETER,
  authGuardRuntime = NO_AUTH_GUARD_RUNTIME,
  logger
}) {
  const resolvedMobileConfig = resolveMobileConfig({
    mobile: mobileConfig
  });
  /** @type {import("../types.js").MobileLaunchRouting | null} */
  let launchRouting = null;
  let initialized = false;
  let lastAppliedPath = "";
  let authGuardReadyPromise = null;
  let removeBackButtonListener = null;

  async function ensureAuthGuardReady() {
    if (authGuardReadyPromise) {
      return authGuardReadyPromise;
    }

    authGuardReadyPromise = authGuardRuntime.initialize();

    try {
      return await authGuardReadyPromise;
    } catch (error) {
      authGuardReadyPromise = null;
      throw error;
    }
  }

  async function resolveTargetPath({ originalUrl = "", normalizedTargetPath = "" } = {}) {
    if (!isAuthCallbackTargetPath(normalizedTargetPath, resolvedMobileConfig)) {
      return normalizedTargetPath;
    }

    const fallbackReturnTo = String(router.currentRoute.value.fullPath || "/").trim() || "/";
    const authResult = await authCallbackCompleter.completeFromUrl({
      url: originalUrl,
      fallbackReturnTo,
      placementContext: placementRuntime.getContext(),
      defaultProvider: String(authGuardRuntime.getState().oauthDefaultProvider || ""),
      refreshSession: () => authGuardRuntime.refresh()
    });

    if (authResult.completed === true) {
      return authResult.returnTo || fallbackReturnTo;
    }

    return normalizedTargetPath;
  }

  function createLaunchRouting() {
    return registerMobileLaunchRouting({
      router,
      mobileConfig: resolvedMobileConfig,
      getInitialLaunchUrl: () => adapter.getInitialLaunchUrl(),
      subscribeToLaunchUrls: (handler) => adapter.subscribeToLaunchUrls(handler),
      resolveTargetPath,
      logger
    });
  }

  function wireBackButtonHandling() {
    removeBackButtonListener = adapter.subscribeToBackButton(async (event) => {
      if (event.canGoBack === true) {
        router.back();
        return;
      }

      await adapter.exitApp();
    });
  }

  async function initialize() {
    if (initialized) {
      return lastAppliedPath;
    }

    initialized = true;
    await ensureAuthGuardReady();
    launchRouting = createLaunchRouting();
    wireBackButtonHandling();
    lastAppliedPath = await launchRouting.initialize();
    return lastAppliedPath;
  }

  async function applyIncomingUrl(url = "", reason = "manual") {
    if (!launchRouting) {
      await ensureAuthGuardReady();
      launchRouting = createLaunchRouting();
    }

    lastAppliedPath = await launchRouting.applyIncomingUrl(url, reason);
    return lastAppliedPath;
  }

  function dispose() {
    if (launchRouting) {
      launchRouting.dispose();
    }
    if (removeBackButtonListener) {
      removeBackButtonListener();
    }
    launchRouting = null;
    removeBackButtonListener = null;
    initialized = false;
  }

  function getState() {
    return Object.freeze({
      initialized,
      available: adapter.available === true,
      enabled: resolvedMobileConfig.enabled === true,
      lastAppliedPath
    });
  }

  return Object.freeze({
    initialize,
    applyIncomingUrl,
    dispose,
    getState
  });
}

export { createMobileCapacitorRuntime };
