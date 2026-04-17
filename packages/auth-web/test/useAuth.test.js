import assert from "node:assert/strict";
import test from "node:test";
import { createSSRApp } from "vue";
import { createAuthStore, useAuth } from "../src/client/composables/useAuth.js";
import { AUTH_GUARD_RUNTIME_INJECTION_KEY, useAuthGuardRuntime } from "../src/client/runtime/inject.js";

function createAuthRuntimeStub(initialState = {}) {
  let state = Object.freeze({
    authenticated: Boolean(initialState.authenticated),
    username: String(initialState.username || ""),
    oauthDefaultProvider: String(initialState.oauthDefaultProvider || ""),
    oauthProviders: Array.isArray(initialState.oauthProviders)
      ? Object.freeze([...initialState.oauthProviders])
      : Object.freeze([])
  });
  const listeners = new Set();

  return {
    async initialize() {
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
    }
  };
}

test("createAuthStore exposes reactive auth refs and direct runtime methods", async () => {
  const runtime = createAuthRuntimeStub({
    authenticated: false,
    username: ""
  });

  const auth = createAuthStore({
    runtime
  });

  assert.equal(auth.runtime, runtime);
  assert.equal(auth.authenticated.value, false);
  assert.equal(auth.username.value, "");
  assert.deepEqual(auth.oauthProviders.value, []);
  assert.equal(auth.oauthDefaultProvider.value, "");
  assert.equal(auth.getState().authenticated, false);
  assert.equal(await auth.refresh(), runtime.getState());

  runtime.push({
    authenticated: true,
    username: "ada",
    oauthProviders: [{ id: "google", label: "Google" }],
    oauthDefaultProvider: "google"
  });

  assert.equal(auth.authenticated.value, true);
  assert.equal(auth.username.value, "ada");
  assert.deepEqual(auth.oauthProviders.value, [{ id: "google", label: "Google" }]);
  assert.equal(auth.oauthDefaultProvider.value, "google");
  assert.equal(auth.getState().authenticated, true);

  let observedState = null;
  const unsubscribe = auth.subscribe((nextState) => {
    observedState = nextState;
  });

  runtime.push({
    authenticated: true,
    username: "grace"
  });

  assert.equal(observedState?.username, "grace");
  unsubscribe();
});

test("useAuth reuses the same shared store injected from the runtime", () => {
  const runtime = createAuthRuntimeStub({
    authenticated: true,
    username: "ada"
  });
  const app = createSSRApp({});
  app.provide(AUTH_GUARD_RUNTIME_INJECTION_KEY, runtime);

  const runtimeFromInjection = app.runWithContext(() => useAuthGuardRuntime({ required: true }));
  const authFromFirstCall = app.runWithContext(() => useAuth({ required: true }));
  const authFromSecondCall = app.runWithContext(() => useAuth({ required: true }));

  assert.equal(runtimeFromInjection, runtime);
  assert.equal(authFromFirstCall, authFromSecondCall);
  assert.equal(authFromFirstCall.runtime, runtime);
  assert.equal(authFromFirstCall.authenticated.value, true);
  assert.equal(authFromFirstCall.username.value, "ada");
});
