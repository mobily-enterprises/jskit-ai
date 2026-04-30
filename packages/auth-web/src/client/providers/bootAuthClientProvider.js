import { AUTH_GUARD_RUNTIME_INJECTION_KEY } from "../runtime/inject.js";
import { useAuthStore } from "../stores/useAuthStore.js";

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

  vueApp.provide(AUTH_GUARD_RUNTIME_INJECTION_KEY, authGuardRuntime);
}

export { bootAuthClientProvider };
