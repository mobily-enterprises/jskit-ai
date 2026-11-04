import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { getClientAppConfig, resolveMobileConfig } from "@jskit-ai/kernel/client";
import { createGlobalCapacitorAppAdapter } from "../runtime/globalCapacitorAppAdapter.js";
import { createCapacitorAwareFetch } from "../runtime/apiRequestClient.js";
import { createMobileCapacitorRuntime } from "../runtime/mobileCapacitorRuntime.js";
import { createCapacitorAwareOAuthLaunchClient } from "../runtime/oauthLaunchClient.js";

const GLOBAL_FETCH_RESTORE_KEY = Symbol.for("jskit.mobile.capacitor.restoreFetch");

function keepPageFetch() {}

/**
 * Inside a Capacitor shell, sends the page's relative API requests to the application's server.
 * @param {object} options
 * @param {import("../types.js").CapacitorAppAdapter} options.adapter
 * @param {string} [options.apiBaseUrl]
 * @param {typeof globalThis} [options.globalObject]
 * @returns {() => void} Puts the page's own fetch back.
 */
function installCapacitorAwareGlobalFetch({ adapter, apiBaseUrl = "", globalObject = globalThis }) {
  if (adapter.available !== true) {
    return keepPageFetch;
  }
  if (globalObject[GLOBAL_FETCH_RESTORE_KEY]) {
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

const MobileCapacitorClientProvider = defineProvider({
  id: "mobile.capacitor.client",
  provides: {
    mobile: "client.mobile"
  },
  setup() {
    const adapter = createGlobalCapacitorAppAdapter();
    const config = resolveMobileConfig(getClientAppConfig());
    const restoreFetch = installCapacitorAwareGlobalFetch({
      adapter,
      apiBaseUrl: config.apiBaseUrl
    });
    return {
      mobile: Object.freeze({
        adapter,
        config,
        oauthLaunch: createCapacitorAwareOAuthLaunchClient({
          adapter,
          apiBaseUrl: config.apiBaseUrl
        }),
        restoreFetch
      })
    };
  },
  /**
   * @param {unknown} _dependencies
   * @param {{ outputs: { mobile: import("../types.js").MobileCapability } }} lifecycle
   */
  shutdown(_dependencies, { outputs }) {
    outputs.mobile.restoreFetch();
  }
});

const MobileCapacitorRuntimeProvider = defineProvider({
  id: "mobile.capacitor.runtime.client",
  requires: {
    mobile: "client.mobile",
    router: "client.router"
  },
  optional: {
    auth: "client.auth",
    shell: "client.shell"
  },
  provides: {
    mobileRuntime: "client.mobile-runtime"
  },
  /**
   * @param {object} capabilities
   * @param {import("../types.js").MobileCapability} capabilities.mobile
   * @param {import("../types.js").ClientRouter} capabilities.router
   * @param {{ mobileCallback: import("../types.js").MobileAuthCallbackCompleter, guard: import("../types.js").MobileAuthGuardRuntime }} [capabilities.auth]
   * @param {{ placement: import("../types.js").MobilePlacementRuntime }} [capabilities.shell]
   */
  setup({ auth, mobile, router, shell }) {
    return {
      mobileRuntime: createMobileCapacitorRuntime({
        router,
        mobileConfig: getClientAppConfig().mobile || {},
        adapter: mobile.adapter,
        placementRuntime: shell?.placement,
        authCallbackCompleter: auth?.mobileCallback,
        authGuardRuntime: auth?.guard
      })
    };
  },
  /**
   * @param {unknown} _dependencies
   * @param {{ outputs: { mobileRuntime: import("../types.js").MobileCapacitorRuntime } }} lifecycle
   */
  async boot(_dependencies, { outputs }) {
    await outputs.mobileRuntime.initialize();
  },
  /**
   * @param {unknown} _dependencies
   * @param {{ outputs: { mobileRuntime: import("../types.js").MobileCapacitorRuntime } }} lifecycle
   */
  shutdown(_dependencies, { outputs }) {
    outputs.mobileRuntime.dispose();
  }
});

export {
  MobileCapacitorClientProvider,
  MobileCapacitorRuntimeProvider,
  installCapacitorAwareGlobalFetch
};
