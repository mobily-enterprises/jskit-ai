import assert from "node:assert/strict";
import test from "node:test";
import { createPinia } from "pinia";
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

test("auth store exposes reactive state and direct runtime methods", async () => {
  const pinia = createPinia();
  const runtime = createAuthRuntimeStub({
    authenticated: false,
    username: ""
  });
  const auth = useAuthStore(pinia);

  auth.attachRuntime(runtime);

  assert.equal(auth.runtime, runtime);
  assert.equal(auth.authenticated, false);
  assert.equal(auth.username, "");
  assert.deepEqual(auth.oauthProviders, []);
  assert.equal(auth.oauthDefaultProvider, "");
  assert.equal(auth.getState().authenticated, false);
  assert.equal(await auth.refresh(), runtime.getState());

  runtime.push({
    authenticated: true,
    username: "ada",
    oauthProviders: [{ id: "google", label: "Google" }],
    oauthDefaultProvider: "google"
  });

  assert.equal(auth.authenticated, true);
  assert.equal(auth.username, "ada");
  assert.deepEqual(auth.oauthProviders, [{ id: "google", label: "Google" }]);
  assert.equal(auth.oauthDefaultProvider, "google");
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
