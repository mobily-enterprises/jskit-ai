export { AuthWebClientProvider } from "./providers/AuthWebClientProvider.js";
import DefaultLoginView from "./views/DefaultLoginView.vue";
import DefaultSignOutView from "./views/DefaultSignOutView.vue";
import { initializeAuthGuardRuntime } from "./runtime/authGuardRuntime.js";
export { default as DefaultLoginView } from "./views/DefaultLoginView.vue";
export { default as LoginView } from "./views/DefaultLoginView.vue";
export { default as DefaultSignOutView } from "./views/DefaultSignOutView.vue";
export { default as SignOutView } from "./views/DefaultSignOutView.vue";
export { useDefaultLoginView } from "./composables/useDefaultLoginView.js";
export { useDefaultSignOutView } from "./composables/useDefaultSignOutView.js";
export { authHttpRequest, clearAuthCsrfTokenCache } from "./api/AuthHttpClient.js";
export { useSignOut, createSignOutAction, performSignOutRequest } from "./composables/useSignOut.js";
export { registerClientRoutes } from "./routes/registerClientRoutes.js";

const routeComponents = Object.freeze({
  "auth-login": DefaultLoginView,
  "auth-signout": DefaultSignOutView
});

function buildDefaultLoginRoute({ component = DefaultLoginView, path = "/auth/default-login", meta = {} } = {}) {
  return {
    id: "auth.default-login",
    name: "auth-default-login",
    path,
    scope: "global",
    component,
    meta: {
      ...meta,
      guard: {
        policy: "public",
        ...(meta?.guard || {})
      },
      jskit: {
        scope: "global",
        routeId: "auth.default-login"
      }
    }
  };
}

export function bootDefaultLoginRoute(context = {}) {
  const { registerRoutes, ...options } = context;
  if (typeof registerRoutes !== "function") {
    throw new Error("bootDefaultLoginRoute requires registerRoutes().");
  }

  registerRoutes([buildDefaultLoginRoute(options)]);
}

async function bootClient(context) {
  await initializeAuthGuardRuntime({ loginRoute: "/auth/login" });
  bootDefaultLoginRoute(context);
}

export { routeComponents, bootClient };
