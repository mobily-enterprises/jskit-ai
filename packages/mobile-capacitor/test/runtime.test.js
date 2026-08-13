import assert from "node:assert/strict";
import test from "node:test";
import {
  createGlobalCapacitorAppAdapter,
  createNoopCapacitorAppAdapter
} from "../src/client/runtime/globalCapacitorAppAdapter.js";
import { createMobileCapacitorRuntime } from "../src/client/runtime/mobileCapacitorRuntime.js";
import {
  createCapacitorAwareFetch,
  isCapacitorApiRequestTarget,
  resolveCapacitorAbsoluteHttpUrl
} from "../src/client/runtime/apiRequestClient.js";
import {
  createCapacitorAwareOAuthLaunchClient,
  resolveCapacitorLaunchUrl
} from "../src/client/runtime/oauthLaunchClient.js";

function createNavigationDouble({
  pop = async () => ({ status: "blocked", reason: "no-in-app-previous-destination" }),
  replace = null,
  ready = false
} = {}) {
  return Object.freeze({
    pop,
    state: Object.freeze({ ready }),
    ...(replace ? { replace } : {})
  });
}

test("createNoopCapacitorAppAdapter returns a stable disabled adapter", async () => {
  const adapter = createNoopCapacitorAppAdapter();

  assert.equal(adapter.available, false);
  assert.equal(await adapter.getInitialLaunchUrl(), "");
  assert.equal(typeof adapter.subscribeToLaunchUrls(() => {}), "function");
  assert.equal(typeof adapter.subscribeToBackButton(() => {}), "function");
  assert.equal(await adapter.exitApp(), false);
});

test("createGlobalCapacitorAppAdapter reads launch URLs from a Capacitor App plugin", async () => {
  const listeners = new Map();
  let exitCalls = 0;
  const adapter = createGlobalCapacitorAppAdapter({
    appPlugin: {
      async getLaunchUrl() {
        return {
          url: "convict://w/acme"
        };
      },
      addListener(eventName, handler) {
        listeners.set(eventName, handler);
        return {
          remove() {
            listeners.delete(eventName);
          }
        };
      },
      async exitApp() {
        exitCalls += 1;
      }
    }
  });

  assert.equal(adapter.available, true);
  assert.equal(await adapter.getInitialLaunchUrl(), "convict://w/acme");

  const urls = [];
  const unsubscribe = adapter.subscribeToLaunchUrls((url) => {
    urls.push(url);
  });
  listeners.get("appUrlOpen")({
    url: "convict://auth/login?code=abc"
  });
  assert.deepEqual(urls, ["convict://auth/login?code=abc"]);

  const backEvents = [];
  const unsubscribeBack = adapter.subscribeToBackButton((event) => {
    backEvents.push(event);
  });
  listeners.get("backButton")({
    canGoBack: true
  });
  assert.deepEqual(backEvents, [
    {
      canGoBack: true
    }
  ]);
  assert.equal(await adapter.exitApp(), true);
  assert.equal(exitCalls, 1);

  unsubscribe();
  unsubscribeBack();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(listeners.has("appUrlOpen"), false);
  assert.equal(listeners.has("backButton"), false);
});

test("createCapacitorAwareOAuthLaunchClient uses Capacitor Browser inside the shell", async () => {
  const openCalls = [];
  const launchClient = createCapacitorAwareOAuthLaunchClient({
    adapter: {
      available: true
    },
    apiBaseUrl: "https://api.example.com",
    browserPlugin: {
      async open(input = {}) {
        openCalls.push(input);
      }
    }
  });

  const opened = await launchClient.open({
    url: "/api/oauth/google/start?returnTo=%2Fw%2Facme"
  });

  assert.equal(opened, true);
  assert.deepEqual(openCalls, [
    {
      url: "https://api.example.com/api/oauth/google/start?returnTo=%2Fw%2Facme"
    }
  ]);
});

test("resolveCapacitorLaunchUrl requires apiBaseUrl for relative shell launches", () => {
  assert.throws(
    () => resolveCapacitorLaunchUrl("/api/oauth/google/start?returnTo=%2Fw%2Facme", ""),
    /config\.mobile\.apiBaseUrl is required/
  );
});

test("resolveCapacitorAbsoluteHttpUrl resolves relative API URLs against apiBaseUrl", () => {
  assert.equal(
    resolveCapacitorAbsoluteHttpUrl("/api/session", "http://127.0.0.1:3000"),
    "http://127.0.0.1:3000/api/session"
  );
});

test("isCapacitorApiRequestTarget only rewrites known server endpoints", () => {
  assert.equal(isCapacitorApiRequestTarget("/api/session"), true);
  assert.equal(isCapacitorApiRequestTarget("/socket.io/?EIO=4"), true);
  assert.equal(isCapacitorApiRequestTarget("https://localhost/api/session"), false);
  assert.equal(isCapacitorApiRequestTarget("https://localhost/socket.io/?EIO=4"), false);
  assert.equal(isCapacitorApiRequestTarget("/assets/index.js"), false);
  assert.equal(isCapacitorApiRequestTarget("assets/index.js"), false);
});

test("createCapacitorAwareFetch rewrites relative API requests inside the shell", async () => {
  const calls = [];
  const wrappedFetch = createCapacitorAwareFetch({
    fetchImpl: async (url, options) => {
      calls.push({
        url,
        options
      });
      return {
        ok: true
      };
    },
    adapter: {
      available: true
    },
    apiBaseUrl: "http://127.0.0.1:3000"
  });

  await wrappedFetch("/api/session", {
    method: "GET"
  });
  await wrappedFetch("/socket.io/?EIO=4&transport=polling");
  await wrappedFetch("/assets/index.js");

  assert.deepEqual(calls, [
    {
      url: "http://127.0.0.1:3000/api/session",
      options: {
        method: "GET"
      }
    },
    {
      url: "http://127.0.0.1:3000/socket.io/?EIO=4&transport=polling",
      options: undefined
    },
    {
      url: "/assets/index.js",
      options: undefined
    }
  ]);
});

test("createCapacitorAwareOAuthLaunchClient falls back to browser navigation outside the shell", async () => {
  const assignedTargets = [];
  const launchClient = createCapacitorAwareOAuthLaunchClient({
    adapter: {
      available: false
    },
    location: {
      assign(target) {
        assignedTargets.push(target);
      }
    }
  });

  const opened = await launchClient.open({
    url: "/api/oauth/google/start?returnTo=%2Fw%2Facme"
  });

  assert.equal(opened, true);
  assert.deepEqual(assignedTargets, [
    "/api/oauth/google/start?returnTo=%2Fw%2Facme"
  ]);
});

test("mobile capacitor runtime routes an initial launch URL through kernel mobile routing", async () => {
  const replaceCalls = [];
  const runtime = createMobileCapacitorRuntime({
    navigation: createNavigationDouble(),
    router: {
      currentRoute: {
        value: {
          fullPath: "/home"
        }
      },
      async replace(target) {
        replaceCalls.push(target);
      }
    },
    mobileConfig: {
      enabled: true,
      auth: {
        customScheme: "convict"
      }
    },
    adapter: {
      available: true,
      async getInitialLaunchUrl() {
        return "convict://w/acme";
      },
      subscribeToLaunchUrls() {
        return () => {};
      }
    }
  });

  const targetPath = await runtime.initialize();

  assert.equal(targetPath, "/w/acme");
  assert.deepEqual(replaceCalls, ["/w/acme"]);
  assert.deepEqual(runtime.getState(), {
    initialized: true,
    available: true,
    enabled: true,
    lastAppliedPath: "/w/acme"
  });
});

test("mobile capacitor runtime shares concurrent initialization and wires listeners once", async () => {
  let initialUrlCalls = 0;
  let launchSubscriptions = 0;
  let backSubscriptions = 0;
  let releaseInitialUrl;
  const initialUrlReady = new Promise((resolve) => {
    releaseInitialUrl = resolve;
  });
  const runtime = createMobileCapacitorRuntime({
    navigation: createNavigationDouble(),
    router: {
      currentRoute: { value: { fullPath: "/home" } },
      async replace() {}
    },
    mobileConfig: { enabled: true, auth: { customScheme: "convict" } },
    adapter: {
      available: true,
      async getInitialLaunchUrl() {
        initialUrlCalls += 1;
        await initialUrlReady;
        return "convict://w/acme";
      },
      subscribeToLaunchUrls() {
        launchSubscriptions += 1;
        return () => {};
      },
      subscribeToBackButton() {
        backSubscriptions += 1;
        return () => {};
      }
    }
  });

  const first = runtime.initialize();
  const second = runtime.initialize();
  releaseInitialUrl();

  assert.deepEqual(await Promise.all([first, second]), ["/w/acme", "/w/acme"]);
  assert.equal(initialUrlCalls, 1);
  assert.equal(launchSubscriptions, 1);
  assert.equal(backSubscriptions, 1);
  runtime.dispose();
});

test("mobile capacitor runtime can retry after initialization fails", async () => {
  let initialUrlCalls = 0;
  const runtime = createMobileCapacitorRuntime({
    navigation: createNavigationDouble(),
    router: {
      currentRoute: { value: { fullPath: "/home" } },
      async replace() {}
    },
    mobileConfig: { enabled: true, auth: { customScheme: "convict" } },
    adapter: {
      available: true,
      async getInitialLaunchUrl() {
        initialUrlCalls += 1;
        if (initialUrlCalls === 1) {
          throw new Error("initial URL unavailable");
        }
        return "";
      },
      subscribeToLaunchUrls() {
        return () => {};
      }
    }
  });

  await assert.rejects(runtime.initialize(), /initial URL unavailable/);
  assert.equal(runtime.getState().initialized, false);
  assert.equal(await runtime.initialize(), "");
  assert.equal(runtime.getState().initialized, true);
  assert.equal(initialUrlCalls, 2);
  runtime.dispose();
});

test("mobile capacitor runtime waits for auth guard initialization before applying launch routing", async () => {
  const order = [];
  const replaceCalls = [];
  const runtime = createMobileCapacitorRuntime({
    navigation: createNavigationDouble(),
    router: {
      currentRoute: {
        value: {
          fullPath: "/home"
        }
      },
      async replace(target) {
        order.push(`router.replace:${target}`);
        replaceCalls.push(target);
      }
    },
    mobileConfig: {
      enabled: true,
      auth: {
        customScheme: "convict"
      }
    },
    adapter: {
      available: true,
      async getInitialLaunchUrl() {
        order.push("adapter.getInitialLaunchUrl");
        return "convict://w/acme";
      },
      subscribeToLaunchUrls() {
        return () => {};
      }
    },
    authGuardRuntime: {
      async initialize() {
        order.push("auth.initialize:start");
        await Promise.resolve();
        order.push("auth.initialize:end");
        return {
          authenticated: true
        };
      },
      async refresh() {
        order.push("auth.refresh");
        return {
          authenticated: true
        };
      },
      getState() {
        return {
          authenticated: true,
          oauthDefaultProvider: "google"
        };
      }
    }
  });

  const targetPath = await runtime.initialize();

  assert.equal(targetPath, "/w/acme");
  assert.deepEqual(replaceCalls, ["/w/acme"]);
  assert.deepEqual(order, [
    "auth.initialize:start",
    "auth.initialize:end",
    "adapter.getInitialLaunchUrl",
    "router.replace:/w/acme"
  ]);
});

test("mobile launch events use the shared navigation replacement after bootstrap", async () => {
  const routerReplaceCalls = [];
  const navigationReplaceCalls = [];
  const runtime = createMobileCapacitorRuntime({
    navigation: createNavigationDouble({
      ready: true,
      async replace(target, options) {
        navigationReplaceCalls.push({ target, options });
        return { status: "completed" };
      }
    }),
    router: {
      currentRoute: { value: { fullPath: "/home" } },
      async replace(target) {
        routerReplaceCalls.push(target);
      }
    },
    mobileConfig: {
      enabled: true,
      auth: { customScheme: "convict" }
    },
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

  await runtime.initialize();
  await runtime.applyIncomingUrl("convict://w/acme/inventory", "launch-event");

  assert.deepEqual(routerReplaceCalls, []);
  assert.deepEqual(navigationReplaceCalls, [{
    target: "/w/acme/inventory",
    options: {
      reason: "programmatic",
      preserveDestinationIdentity: false,
      focus: "heading"
    }
  }]);
});

test("mobile capacitor runtime resolves successful auth callbacks to the returned destination", async () => {
  const replaceCalls = [];
  const runtime = createMobileCapacitorRuntime({
    navigation: createNavigationDouble(),
    router: {
      currentRoute: {
        value: {
          fullPath: "/w/acme/settings"
        }
      },
      async replace(target) {
        replaceCalls.push(target);
      }
    },
    mobileConfig: {
      enabled: true,
      auth: {
        customScheme: "convict",
        callbackPath: "/auth/login"
      }
    },
    adapter: {
      available: true,
      async getInitialLaunchUrl() {
        return "";
      },
      subscribeToLaunchUrls() {
        return () => {};
      }
    },
    placementRuntime: {
      getContext() {
        return {
          surfaceConfig: {
            defaultSurfaceId: "app"
          }
        };
      }
    },
    authGuardRuntime: {
      getState() {
        return {
          oauthDefaultProvider: "google"
        };
      },
      async refresh() {
        return {
          authenticated: true
        };
      }
    },
    authCallbackCompleter: {
      async completeFromUrl(input) {
        assert.equal(input.url, "convict://auth/login?code=abc");
        assert.equal(input.fallbackReturnTo, "/w/acme/settings");
        assert.equal(input.defaultProvider, "google");
        assert.equal(typeof input.refreshSession, "function");
        return {
          handled: true,
          completed: true,
          returnTo: "/w/acme/workouts/2026-05-07"
        };
      }
    }
  });

  const targetPath = await runtime.applyIncomingUrl("convict://auth/login?code=abc", "launch-event");

  assert.equal(targetPath, "/w/acme/workouts/2026-05-07");
  assert.deepEqual(replaceCalls, ["/w/acme/workouts/2026-05-07"]);
});

test("mobile capacitor runtime falls back to the normalized callback route when auth completion does not finish", async () => {
  const replaceCalls = [];
  const runtime = createMobileCapacitorRuntime({
    navigation: createNavigationDouble(),
    router: {
      currentRoute: {
        value: {
          fullPath: "/home"
        }
      },
      async replace(target) {
        replaceCalls.push(target);
      }
    },
    mobileConfig: {
      enabled: true,
      auth: {
        customScheme: "convict",
        callbackPath: "/auth/login"
      }
    },
    adapter: {
      available: true,
      async getInitialLaunchUrl() {
        return "";
      },
      subscribeToLaunchUrls() {
        return () => {};
      }
    },
    authCallbackCompleter: {
      async completeFromUrl() {
        return {
          handled: true,
          completed: false,
          errorMessage: "OAuth provider is missing from callback."
        };
      }
    }
  });

  const targetPath = await runtime.applyIncomingUrl("convict://auth/login?code=abc", "launch-event");

  assert.equal(targetPath, "/auth/login?code=abc");
  assert.deepEqual(replaceCalls, ["/auth/login?code=abc"]);
});

test("mobile capacitor runtime delegates Capacitor Back to the shared navigation runtime", async () => {
  const replaceCalls = [];
  const popCalls = [];
  const popResults = [
    { status: "completed", reason: "transient-layer-closed" },
    { status: "cancelled", reason: "router-navigation-cancelled" },
    { status: "blocked", reason: "no-in-app-previous-destination" }
  ];
  let backButtonHandler = null;
  let exitCalls = 0;
  const runtime = createMobileCapacitorRuntime({
    navigation: createNavigationDouble({
      async pop(options) {
        popCalls.push(options);
        return popResults.shift();
      }
    }),
    router: {
      currentRoute: {
        value: {
          fullPath: "/w/acme/workouts/2026-05-07"
        }
      },
      async replace(target) {
        replaceCalls.push(target);
      }
    },
    mobileConfig: {
      enabled: true,
      auth: {
        customScheme: "convict"
      }
    },
    adapter: {
      available: true,
      async getInitialLaunchUrl() {
        return "";
      },
      subscribeToLaunchUrls() {
        return () => {};
      },
      subscribeToBackButton(handler) {
        backButtonHandler = handler;
        return () => {
          backButtonHandler = null;
        };
      },
      async exitApp() {
        exitCalls += 1;
        return true;
      }
    }
  });

  await runtime.initialize();
  await backButtonHandler({
    canGoBack: true
  });
  await backButtonHandler({
    canGoBack: false
  });
  await backButtonHandler({
    canGoBack: true
  });

  assert.deepEqual(replaceCalls, []);
  assert.deepEqual(popCalls, [
    { reason: "system-back" },
    { reason: "system-back" },
    { reason: "system-back" }
  ]);
  assert.equal(exitCalls, 1);

  runtime.dispose();
  assert.equal(backButtonHandler, null);
});
