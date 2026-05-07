import { registerMobileLaunchRouting, resolveMobileConfig } from "@jskit-ai/kernel/client";
import { createNoopCapacitorAppAdapter } from "./globalCapacitorAppAdapter.js";

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

function normalizeCallbackCompleter(value = null) {
  if (value && typeof value.completeFromUrl === "function") {
    return value;
  }

  if (typeof value === "function") {
    return Object.freeze({
      completeFromUrl: value
    });
  }

  return null;
}

function normalizeAuthGuardRuntime(value = null) {
  if (
    value &&
    typeof value === "object" &&
    typeof value.getState === "function" &&
    (typeof value.initialize === "function" || typeof value.refresh === "function")
  ) {
    return value;
  }

  return null;
}

function isAuthCallbackTargetPath(targetPath = "", mobileConfig = {}) {
  const callbackPath = String(mobileConfig?.auth?.callbackPath || "").trim();
  if (!callbackPath) {
    return false;
  }

  return extractPathname(targetPath) === callbackPath;
}

function createMobileCapacitorRuntime({
  router,
  mobileConfig = {},
  adapter = createNoopCapacitorAppAdapter(),
  placementRuntime = null,
  authCallbackCompleter = null,
  authGuardRuntime = null,
  logger = null
} = {}) {
  if (!router || typeof router.replace !== "function") {
    throw new TypeError("createMobileCapacitorRuntime requires router.replace().");
  }

  const resolvedMobileConfig = resolveMobileConfig({
    mobile: mobileConfig
  });
  const resolvedAdapter = adapter && typeof adapter === "object" ? adapter : createNoopCapacitorAppAdapter();
  const resolvedAuthCallbackCompleter = normalizeCallbackCompleter(authCallbackCompleter);
  const resolvedAuthGuardRuntime = normalizeAuthGuardRuntime(authGuardRuntime);
  let launchRouting = null;
  let initialized = false;
  let lastAppliedPath = "";
  let authGuardReadyPromise = null;
  let removeBackButtonListener = null;

  async function ensureAuthGuardReady() {
    if (!resolvedAuthGuardRuntime) {
      return null;
    }

    if (authGuardReadyPromise) {
      return authGuardReadyPromise;
    }

    authGuardReadyPromise = (async () => {
      if (typeof resolvedAuthGuardRuntime.initialize === "function") {
        return resolvedAuthGuardRuntime.initialize();
      }
      return resolvedAuthGuardRuntime.refresh();
    })();

    try {
      return await authGuardReadyPromise;
    } catch (error) {
      authGuardReadyPromise = null;
      throw error;
    }
  }

  async function resolveTargetPath({ originalUrl = "", normalizedTargetPath = "" } = {}) {
    if (!resolvedAuthCallbackCompleter || !isAuthCallbackTargetPath(normalizedTargetPath, resolvedMobileConfig)) {
      return normalizedTargetPath;
    }

    const fallbackReturnTo = String(router.currentRoute?.value?.fullPath || "/").trim() || "/";
    const authResult = await resolvedAuthCallbackCompleter.completeFromUrl({
      url: originalUrl,
      fallbackReturnTo,
      placementContext: placementRuntime && typeof placementRuntime.getContext === "function"
        ? placementRuntime.getContext()
        : null,
      defaultProvider:
        resolvedAuthGuardRuntime && typeof resolvedAuthGuardRuntime.getState === "function"
          ? String(resolvedAuthGuardRuntime.getState()?.oauthDefaultProvider || "")
          : "",
      refreshSession:
        resolvedAuthGuardRuntime && typeof resolvedAuthGuardRuntime.refresh === "function"
          ? () => resolvedAuthGuardRuntime.refresh()
          : async () => null
    });

    if (authResult?.completed === true) {
      return authResult.returnTo || fallbackReturnTo;
    }

    return normalizedTargetPath;
  }

  function createLaunchRouting() {
    return registerMobileLaunchRouting({
      router,
      mobileConfig: resolvedMobileConfig,
      getInitialLaunchUrl: () => resolvedAdapter.getInitialLaunchUrl(),
      subscribeToLaunchUrls: (handler) => resolvedAdapter.subscribeToLaunchUrls(handler),
      resolveTargetPath,
      logger
    });
  }

  function wireBackButtonHandling() {
    if (typeof resolvedAdapter.subscribeToBackButton !== "function") {
      return;
    }
    if (!router || typeof router.back !== "function") {
      return;
    }

    removeBackButtonListener = resolvedAdapter.subscribeToBackButton(async (event = {}) => {
      if (event?.canGoBack === true) {
        router.back();
        return;
      }

      if (typeof resolvedAdapter.exitApp === "function") {
        await resolvedAdapter.exitApp();
      }
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
    if (launchRouting && typeof launchRouting.dispose === "function") {
      launchRouting.dispose();
    }
    if (typeof removeBackButtonListener === "function") {
      removeBackButtonListener();
    }
    launchRouting = null;
    removeBackButtonListener = null;
    initialized = false;
  }

  function getState() {
    return Object.freeze({
      initialized,
      available: resolvedAdapter.available === true,
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
