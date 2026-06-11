import { inject } from "vue";
import { isAuthGuardRuntime } from "./authGuardRuntime.js";
import { createBrowserOAuthLaunchClient, isAuthOAuthLaunchClient } from "./oauthLaunchClient.js";

const AUTH_GUARD_RUNTIME_INJECTION_KEY = "jskit.auth-web.runtime.auth-guard.client";
const AUTH_OAUTH_LAUNCH_CLIENT_INJECTION_KEY = "jskit.auth-web.runtime.oauth-launch.client";

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

function useAuthOAuthLaunchClient({ required = false } = {}) {
  const client = inject(AUTH_OAUTH_LAUNCH_CLIENT_INJECTION_KEY, null);
  if (isAuthOAuthLaunchClient(client)) {
    return client;
  }

  if (required) {
    throw new Error("OAuth launch client is not available in Vue injection context.");
  }

  return createBrowserOAuthLaunchClient();
}

export {
  AUTH_GUARD_RUNTIME_INJECTION_KEY,
  AUTH_OAUTH_LAUNCH_CLIENT_INJECTION_KEY,
  EMPTY_AUTH_GUARD_STATE,
  EMPTY_AUTH_GUARD_RUNTIME,
  useAuthGuardRuntime,
  useAuthOAuthLaunchClient
};
