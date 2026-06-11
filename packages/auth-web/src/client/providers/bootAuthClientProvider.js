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
  const pinia = app.make("jskit.client.pinia");
  if (!pinia) {
    throw new Error("AuthWebClientProvider requires Pinia installed in the client app.");
  }
  const authStore = useAuthStore(pinia);
  authStore.attachRuntime(authGuardRuntime);
  await authStore.initialize();

  if (app.has("runtime.web-bootstrap.client")) {
    const bootstrapRuntime = app.make("runtime.web-bootstrap.client");
    if (bootstrapRuntime && typeof bootstrapRuntime.refresh === "function") {
      authStore.subscribe(() => {
        void bootstrapRuntime.refresh("auth.state");
      });
    }
  }

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
