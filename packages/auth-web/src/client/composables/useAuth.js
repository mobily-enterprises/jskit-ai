import { computed, inject, readonly, shallowRef } from "vue";
import { isAuthGuardRuntime } from "../runtime/authGuardRuntime.js";
import {
  EMPTY_AUTH_GUARD_RUNTIME,
  EMPTY_AUTH_GUARD_STATE,
  useAuthGuardRuntime
} from "../runtime/inject.js";

const AUTH_STATE_INJECTION_KEY = "jskit.auth-web.state.client";
const authStoreCache = new WeakMap();

function isReadonlyRef(value) {
  return Boolean(value && typeof value === "object" && "value" in value);
}

function isAuthStore(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      isReadonlyRef(value.state) &&
      isReadonlyRef(value.authenticated) &&
      isReadonlyRef(value.username) &&
      isReadonlyRef(value.oauthProviders) &&
      isReadonlyRef(value.oauthDefaultProvider) &&
      typeof value.initialize === "function" &&
      typeof value.refresh === "function" &&
      typeof value.getState === "function" &&
      typeof value.subscribe === "function" &&
      isAuthGuardRuntime(value.runtime)
  );
}

function normalizeAuthStateValue(nextState) {
  if (!nextState || typeof nextState !== "object") {
    return EMPTY_AUTH_GUARD_STATE;
  }
  return nextState;
}

function createAuthStore({ runtime = EMPTY_AUTH_GUARD_RUNTIME } = {}) {
  if (!isAuthGuardRuntime(runtime) || typeof runtime.subscribe !== "function") {
    throw new TypeError("createAuthStore requires an auth guard runtime with subscribe().");
  }

  const cachedStore = authStoreCache.get(runtime);
  if (cachedStore) {
    return cachedStore;
  }

  const state = shallowRef(normalizeAuthStateValue(runtime.getState()));

  runtime.subscribe((nextState) => {
    state.value = normalizeAuthStateValue(nextState);
  });

  const store = Object.freeze({
    runtime,
    state: readonly(state),
    authenticated: computed(() => state.value.authenticated === true),
    username: computed(() => String(state.value.username || "")),
    oauthProviders: computed(() => state.value.oauthProviders || EMPTY_AUTH_GUARD_STATE.oauthProviders),
    oauthDefaultProvider: computed(() => String(state.value.oauthDefaultProvider || "")),
    async initialize(options = {}) {
      return runtime.initialize(options);
    },
    async refresh(options = {}) {
      return runtime.refresh(options);
    },
    getState() {
      return state.value;
    },
    subscribe(listener) {
      return runtime.subscribe(listener);
    }
  });

  authStoreCache.set(runtime, store);
  return store;
}

function useAuth({ required = false } = {}) {
  const injectedStore = inject(AUTH_STATE_INJECTION_KEY, null);
  if (isAuthStore(injectedStore)) {
    return injectedStore;
  }

  const runtime = useAuthGuardRuntime({ required });
  return createAuthStore({ runtime });
}

export {
  AUTH_STATE_INJECTION_KEY,
  createAuthStore,
  isAuthStore,
  useAuth
};
