import { inject } from "vue";
import { normalizeAuthCapabilities } from "@jskit-ai/auth-core/shared/authCapabilities";
import { createPopupOAuthLaunchClient } from "./popupOAuthLaunchClient.js";

const AUTH_GUARD_RUNTIME_INJECTION_KEY = "jskit.auth-web.runtime.auth-guard.client";
const AUTH_OAUTH_LAUNCH_CLIENT_INJECTION_KEY = "jskit.auth-web.runtime.oauth-launch.client";

/** @type {import("../types.js").AuthGuardState} */
const NO_AUTH_GUARD_STATE = Object.freeze({
  authenticated: false,
  username: "",
  email: "",
  permissions: Object.freeze([]),
  oauthDefaultProvider: "",
  oauthProviders: Object.freeze([]),
  authCapabilities: normalizeAuthCapabilities()
});

function stopListening() {}

/**
 * The guard runtime of an application without auth's provider: always signed out.
 * @type {import("../types.js").AuthGuardRuntime}
 */
const NO_AUTH_GUARD_RUNTIME = Object.freeze({
  dispose() {},
  async initialize() {
    return NO_AUTH_GUARD_STATE;
  },
  async refresh() {
    return NO_AUTH_GUARD_STATE;
  },
  getState() {
    return NO_AUTH_GUARD_STATE;
  },
  subscribe() {
    return stopListening;
  }
});

/** @returns {import("../types.js").AuthGuardRuntime} */
function useAuthGuardRuntime() {
  return inject(AUTH_GUARD_RUNTIME_INJECTION_KEY, NO_AUTH_GUARD_RUNTIME);
}

/**
 * The guard runtime for code that cannot work signed out by default.
 * @returns {import("../types.js").AuthGuardRuntime}
 */
function useRequiredAuthGuardRuntime() {
  const runtime = useAuthGuardRuntime();
  if (runtime === NO_AUTH_GUARD_RUNTIME) {
    throw new Error("Auth guard runtime is not available in Vue injection context.");
  }
  return runtime;
}

/**
 * The application's launch client, or a new popup client where the application provides none.
 * @returns {import("../types.js").AuthOAuthLaunchClient}
 */
function useAuthOAuthLaunchClient() {
  return inject(AUTH_OAUTH_LAUNCH_CLIENT_INJECTION_KEY, createPopupOAuthLaunchClient, true);
}

export {
  AUTH_GUARD_RUNTIME_INJECTION_KEY,
  AUTH_OAUTH_LAUNCH_CLIENT_INJECTION_KEY,
  NO_AUTH_GUARD_STATE,
  NO_AUTH_GUARD_RUNTIME,
  useAuthGuardRuntime,
  useAuthOAuthLaunchClient,
  useRequiredAuthGuardRuntime
};
