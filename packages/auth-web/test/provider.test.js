import assert from "node:assert/strict";
import test from "node:test";
import { createPinia } from "pinia";
import { AUTH_GUARD_RUNTIME_INJECTION_KEY } from "../src/client/runtime/inject.js";
import { bootAuthClientProvider } from "../src/client/providers/bootAuthClientProvider.js";
import { useAuthStore } from "../src/client/stores/useAuthStore.js";

function createAuthRuntimeStub(initialState = {}) {
  let state = Object.freeze({
    authenticated: Boolean(initialState.authenticated),
    username: String(initialState.username || ""),
    oauthDefaultProvider: String(initialState.oauthDefaultProvider || ""),
    oauthProviders: Array.isArray(initialState.oauthProviders)
      ? Object.freeze([...initialState.oauthProviders])
      : Object.freeze([])
  });
  let initializeCalls = 0;
  const listeners = new Set();

  return {
    async initialize() {
      initializeCalls += 1;
      return state;
    },
    async refresh() {
      return state;
    },
    getState() {
      return state;
    },
    subscribe(listener) {
      if (typeof listener === "function") {
        listeners.add(listener);
      }
      return () => {
        listeners.delete(listener);
      };
    },
    push(nextState = {}) {
      state = Object.freeze({
        authenticated: Boolean(nextState.authenticated),
        username: String(nextState.username || ""),
        oauthDefaultProvider: String(nextState.oauthDefaultProvider || ""),
        oauthProviders: Array.isArray(nextState.oauthProviders)
          ? Object.freeze([...nextState.oauthProviders])
          : Object.freeze([])
      });

      for (const listener of listeners) {
        listener(state);
      }
    },
    get initializeCalls() {
      return initializeCalls;
    }
  };
}

function createAppDouble({ authGuardRuntime, bootstrapRuntime = null } = {}) {
  const singletons = new Map();
  const singletonInstances = new Map();
  const provided = [];
  const pinia = createPinia();
  const vueApp = {
    provide(key, value) {
      provided.push({ key, value });
    }
  };

  return {
    singletons,
    provided,
    pinia,
    vueApp,
    singleton(token, factory) {
      singletons.set(token, factory);
    },
    has(token) {
      if (token === "jskit.client.vue.app") {
        return true;
      }
      if (token === "jskit.client.pinia") {
        return true;
      }
      if (token === "runtime.web-placement.client") {
        return true;
      }
      if (token === "runtime.auth-guard.client") {
        return true;
      }
      if (token === "runtime.web-bootstrap.client") {
        return Boolean(bootstrapRuntime);
      }
      return singletons.has(token) || singletonInstances.has(token);
    },
    make(token) {
      if (token === "jskit.client.vue.app") {
        return vueApp;
      }
      if (token === "jskit.client.pinia") {
        return pinia;
      }
      if (token === "runtime.web-placement.client") {
        return {
          getContext() {
            return Object.freeze({
              surfaceConfig: Object.freeze({
                enabledSurfaceIds: Object.freeze(["home"]),
                defaultSurfaceId: "home",
                surfaces: Object.freeze({
                  home: Object.freeze({
                    id: "home",
                    origin: "",
                    pagesRoot: "home"
                  }),
                  auth: Object.freeze({
                    id: "auth",
                    origin: "",
                    pagesRoot: "auth"
                  })
                })
              })
            });
          }
        };
      }
      if (token === "runtime.auth-guard.client") {
        return authGuardRuntime;
      }
      if (token === "runtime.web-bootstrap.client") {
        return bootstrapRuntime;
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
}

test("auth web client boot binds explicit Pinia store state and raw runtime injection together", async () => {
  const authGuardRuntime = createAuthRuntimeStub({
    authenticated: true,
    username: "ada"
  });
  const app = createAppDouble({ authGuardRuntime });

  await bootAuthClientProvider(app);

  const authStore = useAuthStore(app.pinia);
  assert.equal(authStore.runtime, authGuardRuntime);
  assert.equal(authStore.authenticated, true);
  assert.equal(authStore.username, "ada");
  assert.equal(authGuardRuntime.initializeCalls, 1);

  authGuardRuntime.push({
    authenticated: true,
    username: "grace"
  });

  assert.equal(authStore.username, "grace");

  const providedByKey = new Map(app.provided.map((entry) => [entry.key, entry.value]));
  assert.equal(providedByKey.get(AUTH_GUARD_RUNTIME_INJECTION_KEY), authGuardRuntime);
});

test("auth web client boot refreshes shared bootstrap runtime on auth changes", async () => {
  const authGuardRuntime = createAuthRuntimeStub({
    authenticated: false,
    username: ""
  });
  const refreshCalls = [];
  const app = createAppDouble({
    authGuardRuntime,
    bootstrapRuntime: {
      async refresh(reason) {
        refreshCalls.push(String(reason || ""));
        return null;
      }
    }
  });

  await bootAuthClientProvider(app);
  assert.deepEqual(refreshCalls, []);

  authGuardRuntime.push({
    authenticated: true,
    username: "ada"
  });

  assert.deepEqual(refreshCalls, ["auth.state"]);
});
