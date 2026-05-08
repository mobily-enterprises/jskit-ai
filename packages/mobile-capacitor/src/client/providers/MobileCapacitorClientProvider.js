import { getClientAppConfig, resolveMobileConfig } from "@jskit-ai/kernel/client";
import { createGlobalCapacitorAppAdapter } from "../runtime/globalCapacitorAppAdapter.js";
import { createCapacitorAwareFetch } from "../runtime/apiRequestClient.js";
import { createMobileCapacitorRuntime } from "../runtime/mobileCapacitorRuntime.js";
import { createCapacitorAwareOAuthLaunchClient } from "../runtime/oauthLaunchClient.js";

const AUTH_OAUTH_LAUNCH_CLIENT_TOKEN = "auth.oauth-launch.client";
const GLOBAL_FETCH_RESTORE_KEY = Symbol.for("jskit.mobile.capacitor.restoreFetch");

function installCapacitorAwareGlobalFetch({ adapter = null, apiBaseUrl = "", globalObject = globalThis } = {}) {
  if (!globalObject || typeof globalObject !== "object") {
    return null;
  }
  if (adapter?.available !== true) {
    return null;
  }
  if (typeof globalObject.fetch !== "function") {
    return null;
  }
  if (typeof globalObject[GLOBAL_FETCH_RESTORE_KEY] === "function") {
    return globalObject[GLOBAL_FETCH_RESTORE_KEY];
  }

  const originalFetch = globalObject.fetch;
  const wrappedFetch = createCapacitorAwareFetch({
    fetchImpl: (...args) => originalFetch(...args),
    adapter,
    apiBaseUrl
  });
  globalObject.fetch = wrappedFetch;

  const restore = () => {
    if (globalObject.fetch === wrappedFetch) {
      globalObject.fetch = originalFetch;
    }
    if (globalObject[GLOBAL_FETCH_RESTORE_KEY] === restore) {
      delete globalObject[GLOBAL_FETCH_RESTORE_KEY];
    }
  };
  globalObject[GLOBAL_FETCH_RESTORE_KEY] = restore;
  return restore;
}

class MobileCapacitorClientProvider {
  static id = "mobile.capacitor.client";

  static dependsOn = ["shell.web.client"];

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("MobileCapacitorClientProvider requires application singleton().");
    }

    let adapterInstance = null;
    if (!app.has || app.has("mobile.capacitor.adapter.client") !== true) {
      adapterInstance = createGlobalCapacitorAppAdapter();
      app.singleton("mobile.capacitor.adapter.client", () => adapterInstance);
    } else if (typeof app.make === "function") {
      adapterInstance = app.make("mobile.capacitor.adapter.client");
    }

    const mobileConfig = resolveMobileConfig(getClientAppConfig());
    installCapacitorAwareGlobalFetch({
      adapter: adapterInstance,
      apiBaseUrl: mobileConfig.apiBaseUrl
    });

    if (!app.has || app.has(AUTH_OAUTH_LAUNCH_CLIENT_TOKEN) !== true) {
      app.singleton(AUTH_OAUTH_LAUNCH_CLIENT_TOKEN, (scope) => {
        return createCapacitorAwareOAuthLaunchClient({
          adapter: scope.make("mobile.capacitor.adapter.client"),
          apiBaseUrl: mobileConfig.apiBaseUrl
        });
      });
    }
    app.singleton("mobile.capacitor.client.runtime", (scope) => {
      if (!scope.has("jskit.client.router")) {
        throw new Error("MobileCapacitorClientProvider requires jskit.client.router.");
      }

      const placementRuntime = scope.has("runtime.web-placement.client")
        ? scope.make("runtime.web-placement.client")
        : null;
      const authCallbackCompleter = scope.has("auth.mobile-callback.client")
        ? scope.make("auth.mobile-callback.client")
        : null;
      const authGuardRuntime = scope.has("runtime.auth-guard.client")
        ? scope.make("runtime.auth-guard.client")
        : null;

      return createMobileCapacitorRuntime({
        router: scope.make("jskit.client.router"),
        mobileConfig: getClientAppConfig().mobile || {},
        adapter: scope.make("mobile.capacitor.adapter.client"),
        placementRuntime,
        authCallbackCompleter,
        authGuardRuntime
      });
    });
  }

  async boot(app) {
    if (!app || typeof app.make !== "function" || typeof app.has !== "function") {
      throw new Error("MobileCapacitorClientProvider boot requires application make()/has().");
    }

    if (!app.has("mobile.capacitor.client.runtime")) {
      return;
    }

    const mobileConfig = resolveMobileConfig(getClientAppConfig());
    installCapacitorAwareGlobalFetch({
      adapter: app.make("mobile.capacitor.adapter.client"),
      apiBaseUrl: mobileConfig.apiBaseUrl
    });

    const runtime = app.make("mobile.capacitor.client.runtime");
    if (runtime && typeof runtime.initialize === "function") {
      await runtime.initialize();
    }
  }

  shutdown(app) {
    if (!app || typeof app.has !== "function" || typeof app.make !== "function") {
      return;
    }

    if (!app.has("mobile.capacitor.client.runtime")) {
      return;
    }

    const restoreFetch = globalThis[GLOBAL_FETCH_RESTORE_KEY];
    if (typeof restoreFetch === "function") {
      restoreFetch();
    }

    const runtime = app.make("mobile.capacitor.client.runtime");
    if (runtime && typeof runtime.dispose === "function") {
      runtime.dispose();
    }
  }
}

export { MobileCapacitorClientProvider, installCapacitorAwareGlobalFetch };
