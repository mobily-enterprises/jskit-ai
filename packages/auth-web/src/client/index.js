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

async function bootClient() {
  await initializeAuthGuardRuntime({ loginRoute: "/auth/login" });
}

export { routeComponents, bootClient };
