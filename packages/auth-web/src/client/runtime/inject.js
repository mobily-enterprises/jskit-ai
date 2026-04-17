import { inject } from "vue";
import { isAuthGuardRuntime } from "./authGuardRuntime.js";

const AUTH_GUARD_RUNTIME_INJECTION_KEY = "jskit.auth-web.runtime.auth-guard.client";

const EMPTY_AUTH_GUARD_STATE = Object.freeze({
  authenticated: false,
  username: "",
  oauthDefaultProvider: "",
  oauthProviders: Object.freeze([])
});

const EMPTY_AUTH_GUARD_RUNTIME = Object.freeze({
  async initialize() {
    return EMPTY_AUTH_GUARD_STATE;
  },
  async refresh() {
    return EMPTY_AUTH_GUARD_STATE;
  },
  getState() {
    return EMPTY_AUTH_GUARD_STATE;
  },
  subscribe() {
    return () => {};
  }
});

function useAuthGuardRuntime({ required = false } = {}) {
  const runtime = inject(AUTH_GUARD_RUNTIME_INJECTION_KEY, null);
  if (isAuthGuardRuntime(runtime)) {
    return runtime;
  }

  if (required) {
    throw new Error("Auth guard runtime is not available in Vue injection context.");
  }

  return EMPTY_AUTH_GUARD_RUNTIME;
}

export {
  AUTH_GUARD_RUNTIME_INJECTION_KEY,
  EMPTY_AUTH_GUARD_STATE,
  EMPTY_AUTH_GUARD_RUNTIME,
  useAuthGuardRuntime
};
