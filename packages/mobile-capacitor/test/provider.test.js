import assert from "node:assert/strict";
import test from "node:test";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import {
  MobileCapacitorClientProvider,
  MobileCapacitorRuntimeProvider
} from "../src/client/providers/MobileCapacitorClientProvider.js";

function createRouter() {
  return {
    currentRoute: {
      value: {
        fullPath: "/home"
      }
    },
    async replace() {},
    back() {}
  };
}

function createMobileProbe(onCapabilities) {
  return defineProvider({
    id: "test.mobile.capacitor.probe",
    requires: {
      mobile: "client.mobile",
      mobileRuntime: "client.mobile-runtime"
    },
    setup(capabilities) {
      onCapabilities(capabilities);
      return {};
    }
  });
}

test("mobile providers publish, boot, and dispose their declared capabilities", async () => {
  const originalCapacitor = globalThis.Capacitor;
  const originalConfig = globalThis.__JSKIT_CLIENT_APP_CONFIG__;
  const listenerEvents = [];
  const removedListeners = [];
  let capabilities = null;

  globalThis.__JSKIT_CLIENT_APP_CONFIG__ = {
    mobile: {
      enabled: true,
      auth: {
        customScheme: "convict"
      }
    }
  };
  globalThis.Capacitor = {
    Plugins: {
      App: {
        async getLaunchUrl() {
          return { url: "" };
        },
        async addListener(eventName) {
          listenerEvents.push(eventName);
          return {
            remove() {
              removedListeners.push(eventName);
            }
          };
        }
      }
    }
  };

  const runtime = createCapabilityRuntime({
    inputs: {
      "client.router": createRouter()
    },
    providers: [
      MobileCapacitorClientProvider,
      MobileCapacitorRuntimeProvider,
      createMobileProbe((value) => {
        capabilities = value;
      })
    ]
  });

  try {
    await runtime.start();
    assert.equal(capabilities.mobile.adapter.available, true);
    assert.equal(typeof capabilities.mobile.oauthLaunch.open, "function");
    assert.deepEqual(capabilities.mobileRuntime.getState(), {
      initialized: true,
      available: true,
      enabled: true,
      lastAppliedPath: ""
    });
    assert.deepEqual(listenerEvents.sort(), ["appUrlOpen", "backButton"]);

    await runtime.shutdown();
    assert.equal(capabilities.mobileRuntime.getState().initialized, false);
    await Promise.resolve();
    assert.deepEqual(removedListeners.sort(), ["appUrlOpen", "backButton"]);
  } finally {
    globalThis.Capacitor = originalCapacitor;
    globalThis.__JSKIT_CLIENT_APP_CONFIG__ = originalConfig;
  }
});

test("mobile provider installs and restores the Capacitor-aware fetch wrapper", async () => {
  const originalCapacitor = globalThis.Capacitor;
  const originalConfig = globalThis.__JSKIT_CLIENT_APP_CONFIG__;
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  const stubFetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return { ok: true };
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
  globalThis.Capacitor = {
    Plugins: {
      App: {
        async getLaunchUrl() {
          return { url: "" };
        },
        async addListener() {
          return { remove() {} };
        }
      }
    }
  };
  globalThis.fetch = stubFetch;

  const runtime = createCapabilityRuntime({
    inputs: {
      "client.router": createRouter()
    },
    providers: [MobileCapacitorClientProvider, MobileCapacitorRuntimeProvider]
  });

  try {
    await runtime.start();
    assert.notEqual(globalThis.fetch, stubFetch);
    await globalThis.fetch("/api/session", { method: "GET" });
    await runtime.shutdown();

    assert.deepEqual(fetchCalls, [{
      url: "http://127.0.0.1:3000/api/session",
      options: { method: "GET" }
    }]);
    assert.equal(globalThis.fetch, stubFetch);
  } finally {
    globalThis.Capacitor = originalCapacitor;
    globalThis.__JSKIT_CLIENT_APP_CONFIG__ = originalConfig;
    globalThis.fetch = originalFetch;
  }
});
