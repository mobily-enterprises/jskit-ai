import {
  AUTH_GUARD_RUNTIME_INJECTION_KEY,
  AUTH_OAUTH_LAUNCH_CLIENT_INJECTION_KEY
} from "../runtime/inject.js";
import { createBrowserOAuthLaunchClient } from "../runtime/oauthLaunchClient.js";
import { useAuthStore } from "../stores/useAuthStore.js";

const AUTH_OAUTH_LAUNCH_CLIENT_TOKEN = "auth.oauth-launch.client";

async function bootAuthClientProvider(app) {
  if (!app || typeof app.make !== "function" || typeof app.has !== "function") {
    throw new Error("AuthWebClientProvider requires application make()/has().");
  }

  const authGuardRuntime = app.make("runtime.auth-guard.client");
  if (!app.has("jskit.client.navigation")) {
    throw new Error("AuthWebClientProvider requires the JSKIT navigation runtime.");
  }
  const navigation = app.make("jskit.client.navigation");
  if (!navigation || typeof navigation.setScope !== "function") {
    throw new Error("AuthWebClientProvider requires navigation.setScope().");
  }
  const pinia = app.make("jskit.client.pinia");
  if (!pinia) {
    throw new Error("AuthWebClientProvider requires Pinia installed in the client app.");
  }
  const authStore = useAuthStore(pinia);
  authStore.attachRuntime(authGuardRuntime);
  const initialAuthState = await authStore.initialize();
  const bootstrapRuntime = app.has("runtime.web-bootstrap.client")
    ? app.make("runtime.web-bootstrap.client")
    : null;
  const logger = app.has("jskit.client.logger") ? app.make("jskit.client.logger") : null;

  async function synchronizePrincipalScope(state = {}) {
    const authenticated = state?.authenticated === true;
    const principal = authenticated ? String(state?.principal || "").trim() : "anonymous";
    if (authenticated && !principal) {
      throw new Error("Authenticated session state requires an opaque principal fingerprint.");
    }
    return navigation.setScope({ principal });
  }

  async function applyAuthState(nextState) {
    await synchronizePrincipalScope(nextState);
    if (bootstrapRuntime && typeof bootstrapRuntime.refresh === "function") {
      await bootstrapRuntime.refresh("auth.state");
    }
  }

  function reportAuthStateFailure(error) {
    logger?.error?.(
      {
        providerId: "auth.web.client",
        error: String(error?.message || error || "unknown error")
      },
      "Failed to synchronize navigation scope after an auth state change."
    );
  }

  await synchronizePrincipalScope(initialAuthState);
  let authStateEffects = Promise.resolve();
  authStore.subscribe((nextState) => {
    authStateEffects = authStateEffects.then(() => applyAuthState(nextState)).catch(reportAuthStateFailure);
  });

  if (!app.has("jskit.client.vue.app")) {
    return;
  }

  const vueApp = app.make("jskit.client.vue.app");
  if (!vueApp || typeof vueApp.provide !== "function") {
    return;
  }

  const oauthLaunchClient = app.has(AUTH_OAUTH_LAUNCH_CLIENT_TOKEN)
    ? app.make(AUTH_OAUTH_LAUNCH_CLIENT_TOKEN)
    : createBrowserOAuthLaunchClient();
  vueApp.provide(AUTH_GUARD_RUNTIME_INJECTION_KEY, authGuardRuntime);
  vueApp.provide(AUTH_OAUTH_LAUNCH_CLIENT_INJECTION_KEY, oauthLaunchClient);
}

export { bootAuthClientProvider };
