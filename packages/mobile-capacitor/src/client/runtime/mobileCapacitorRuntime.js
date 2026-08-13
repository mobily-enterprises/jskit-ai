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
  navigation,
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
  if (!navigation || typeof navigation.pop !== "function") {
    throw new TypeError("createMobileCapacitorRuntime requires the JSKIT navigation runtime.");
  }

  const resolvedMobileConfig = resolveMobileConfig({
    mobile: mobileConfig
  });
  const resolvedAdapter = adapter && typeof adapter === "object" ? adapter : createNoopCapacitorAppAdapter();
  const resolvedAuthCallbackCompleter = normalizeCallbackCompleter(authCallbackCompleter);
  const resolvedAuthGuardRuntime = normalizeAuthGuardRuntime(authGuardRuntime);
  let launchRouting = null;
  let initialized = false;
  let initializationPromise = null;
  let lifecycleGeneration = 0;
  let lastAppliedPath = "";
  let authGuardReadyPromise = null;
  let removeBackButtonListener = null;
  let backButtonOperation = null;
  const launchRouter = Object.freeze({
    currentRoute: router.currentRoute,
    replace(target) {
      if (navigation.state?.ready === true && typeof navigation.replace === "function") {
        return navigation.replace(target, {
          reason: "programmatic",
          preserveDestinationIdentity: false,
          focus: "heading"
        });
      }
      return router.replace(target);
    }
  });

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
      router: launchRouter,
      mobileConfig: resolvedMobileConfig,
      getInitialLaunchUrl: () => resolvedAdapter.getInitialLaunchUrl(),
      subscribeToLaunchUrls: (handler) => resolvedAdapter.subscribeToLaunchUrls(handler),
      resolveTargetPath,
      logger
    });
  }

  function ensureLaunchRouting() {
    if (!launchRouting) {
      launchRouting = createLaunchRouting();
    }
    return launchRouting;
  }

  function wireBackButtonHandling() {
    if (removeBackButtonListener || typeof resolvedAdapter.subscribeToBackButton !== "function") {
      return;
    }

    const unsubscribe = resolvedAdapter.subscribeToBackButton(async () => {
      if (backButtonOperation) {
        return backButtonOperation;
      }
      backButtonOperation = (async () => {
        try {
          const result = await navigation.pop({ reason: "system-back" });
          if (
            result?.status === "blocked" &&
            result?.reason === "no-in-app-previous-destination" &&
            typeof resolvedAdapter.exitApp === "function"
          ) {
            await resolvedAdapter.exitApp();
          }
          return result;
        } catch (error) {
          logger?.error?.(
            { error: String(error?.message || error || "unknown error") },
            "Capacitor Back failed."
          );
          return Object.freeze({ status: "degraded", reason: "system-back-failed" });
        }
      })();
      try {
        return await backButtonOperation;
      } finally {
        backButtonOperation = null;
      }
    });
    removeBackButtonListener = typeof unsubscribe === "function" ? unsubscribe : () => {};
  }

  async function initialize() {
    if (initialized) {
      return lastAppliedPath;
    }
    if (initializationPromise) {
      return initializationPromise;
    }

    const generation = lifecycleGeneration;
    const operation = (async () => {
      await ensureAuthGuardReady();
      if (generation !== lifecycleGeneration) {
        return "";
      }
      const routing = ensureLaunchRouting();
      wireBackButtonHandling();
      const appliedPath = await routing.initialize();
      if (generation !== lifecycleGeneration) {
        return "";
      }
      lastAppliedPath = appliedPath;
      initialized = true;
      return lastAppliedPath;
    })();
    initializationPromise = operation;
    try {
      return await operation;
    } finally {
      if (initializationPromise === operation) {
        initializationPromise = null;
      }
    }
  }

  async function applyIncomingUrl(url = "", reason = "manual") {
    const generation = lifecycleGeneration;
    await ensureAuthGuardReady();
    if (generation !== lifecycleGeneration) {
      return "";
    }
    const routing = ensureLaunchRouting();
    wireBackButtonHandling();
    const appliedPath = await routing.applyIncomingUrl(url, reason);
    if (generation !== lifecycleGeneration) {
      return "";
    }
    lastAppliedPath = appliedPath;
    return lastAppliedPath;
  }

  function dispose() {
    lifecycleGeneration += 1;
    if (launchRouting && typeof launchRouting.dispose === "function") {
      launchRouting.dispose();
    }
    if (typeof removeBackButtonListener === "function") {
      removeBackButtonListener();
    }
    launchRouting = null;
    removeBackButtonListener = null;
    backButtonOperation = null;
    initialized = false;
    initializationPromise = null;
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
