import assert from "node:assert/strict";
import test from "node:test";
import { MobileCapacitorClientProvider } from "../src/client/providers/MobileCapacitorClientProvider.js";

function createAppDouble({
  adapter = null,
  authCallbackCompleter = null,
  authGuardRuntime = null,
  placementRuntime = null
} = {}) {
  const singletons = new Map();
  const singletonInstances = new Map();
  const runtime = {
    initializeCalls: 0,
    disposeCalls: 0
  };

  const app = {
    singleton(token, factory) {
      singletons.set(token, factory);
    },
    has(token) {
      if (token === "jskit.client.router") {
        return true;
      }
      if (token === "runtime.web-placement.client") {
        return Boolean(placementRuntime);
      }
      if (token === "auth.mobile-callback.client") {
        return Boolean(authCallbackCompleter);
      }
      if (token === "runtime.auth-guard.client") {
        return Boolean(authGuardRuntime);
      }
      if (token === "auth.oauth-launch.client") {
        return singletons.has(token) || singletonInstances.has(token);
      }
      return singletons.has(token) || singletonInstances.has(token);
    },
    make(token) {
      if (token === "jskit.client.router") {
        return {
          currentRoute: {
            value: {
              fullPath: "/home"
            }
          },
          async replace() {}
        };
      }
      if (token === "runtime.web-placement.client") {
        return placementRuntime;
      }
      if (token === "auth.mobile-callback.client") {
        return authCallbackCompleter;
      }
      if (token === "runtime.auth-guard.client") {
        return authGuardRuntime;
      }
      if (singletonInstances.has(token)) {
        return singletonInstances.get(token);
      }
      const factory = singletons.get(token);
      if (!factory) {
        throw new Error(`Unknown token ${String(token)}`);
      }
      const instance = factory(this);
      singletonInstances.set(token, instance);
      return instance;
    }
  };

  if (adapter) {
    app.singleton("mobile.capacitor.adapter.client", () => adapter);
  }

  return {
    app,
    runtime,
    singletons,
    singletonInstances
  };
}

test("MobileCapacitorClientProvider registers and boots the mobile runtime", async () => {
  globalThis.__JSKIT_CLIENT_APP_CONFIG__ = {
    mobile: {
      enabled: true,
      auth: {
        customScheme: "convict"
      }
    }
  };

  try {
    const adapter = {
      available: true,
      async getInitialLaunchUrl() {
        return "";
      },
      subscribeToLaunchUrls() {
        return () => {};
      }
    };
    const { app } = createAppDouble({ adapter });
    const provider = new MobileCapacitorClientProvider();

    provider.register(app);

    assert.equal(app.has("mobile.capacitor.adapter.client"), true);
    assert.equal(app.has("mobile.capacitor.client.runtime"), true);
    assert.equal(app.has("auth.oauth-launch.client"), true);

    const runtime = app.make("mobile.capacitor.client.runtime");
    assert.equal(typeof runtime.initialize, "function");
    assert.equal(runtime.getState().available, true);

    await provider.boot(app);
    assert.equal(runtime.getState().initialized, true);

    provider.shutdown(app);
    assert.equal(runtime.getState().initialized, false);
  } finally {
    delete globalThis.__JSKIT_CLIENT_APP_CONFIG__;
  }
});

test("MobileCapacitorClientProvider installs and restores the Capacitor fetch wrapper", async () => {
  const originalConfig = globalThis.__JSKIT_CLIENT_APP_CONFIG__;
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  const stubFetch = async (url, options) => {
    fetchCalls.push({
      url,
      options
    });
    return {
      ok: true
    };
  };

  globalThis.__JSKIT_CLIENT_APP_CONFIG__ = {
    mobile: {
      enabled: true,
      apiBaseUrl: "http://127.0.0.1:3000",
      auth: {
        customScheme: "exampleapp"
      }
    }
  };
  globalThis.fetch = stubFetch;

  try {
    const { app } = createAppDouble({
      adapter: {
        available: true,
        async getInitialLaunchUrl() {
          return "";
        },
        subscribeToLaunchUrls() {
          return () => {};
        }
      }
    });
    const provider = new MobileCapacitorClientProvider();

    provider.register(app);
    await globalThis.fetch("/api/session", {
      method: "GET"
    });
    await provider.boot(app);
    provider.shutdown(app);

    assert.deepEqual(fetchCalls, [
      {
        url: "http://127.0.0.1:3000/api/session",
        options: {
          method: "GET"
        }
      }
    ]);
    assert.equal(globalThis.fetch, stubFetch);
  } finally {
    globalThis.__JSKIT_CLIENT_APP_CONFIG__ = originalConfig;
    globalThis.fetch = originalFetch;
  }
});
