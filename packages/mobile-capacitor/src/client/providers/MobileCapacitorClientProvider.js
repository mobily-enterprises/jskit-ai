import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { getClientAppConfig, resolveMobileConfig } from "@jskit-ai/kernel/client";
import { createGlobalCapacitorAppAdapter } from "../runtime/globalCapacitorAppAdapter.js";
import { createCapacitorAwareFetch } from "../runtime/apiRequestClient.js";
import { createMobileCapacitorRuntime } from "../runtime/mobileCapacitorRuntime.js";
import { createCapacitorAwareOAuthLaunchClient } from "../runtime/oauthLaunchClient.js";

const GLOBAL_FETCH_RESTORE_KEY = Symbol.for("jskit.mobile.capacitor.restoreFetch");

function installCapacitorAwareGlobalFetch({ adapter = null, apiBaseUrl = "", globalObject = globalThis } = {}) {
  if (!globalObject || typeof globalObject !== "object" || adapter?.available !== true) {
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
  shutdown(_dependencies, { outputs }) {
    outputs.mobile.restoreFetch?.();
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
  setup({ auth, mobile, router, shell }) {
    return {
      mobileRuntime: createMobileCapacitorRuntime({
        router,
        mobileConfig: getClientAppConfig().mobile || {},
        adapter: mobile.adapter,
        placementRuntime: shell?.placement || null,
        authCallbackCompleter: auth?.mobileCallback || null,
        authGuardRuntime: auth?.guard || null
      })
    };
  },
  async boot(_dependencies, { outputs }) {
    await outputs.mobileRuntime.initialize();
  },
  shutdown(_dependencies, { outputs }) {
    outputs.mobileRuntime.dispose?.();
  }
});

export {
  MobileCapacitorClientProvider,
  MobileCapacitorRuntimeProvider,
  installCapacitorAwareGlobalFetch
};
