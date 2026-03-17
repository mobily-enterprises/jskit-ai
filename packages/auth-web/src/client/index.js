import { AuthWebClientProvider } from "./providers/AuthWebClientProvider.js";
import DefaultLoginView from "./views/DefaultLoginView.vue";
import DefaultSignOutView from "./views/DefaultSignOutView.vue";
export { AuthWebClientProvider } from "./providers/AuthWebClientProvider.js";
export { default as DefaultLoginView } from "./views/DefaultLoginView.vue";
export { default as LoginView } from "./views/DefaultLoginView.vue";
export { default as DefaultSignOutView } from "./views/DefaultSignOutView.vue";
export { default as SignOutView } from "./views/DefaultSignOutView.vue";
export { default as AuthProfileWidget } from "./views/AuthProfileWidget.vue";
export { default as AuthProfileMenuLinkItem } from "./views/AuthProfileMenuLinkItem.vue";
export { useDefaultLoginView } from "./composables/useDefaultLoginView.js";
export { useDefaultSignOutView } from "./composables/useDefaultSignOutView.js";
export { resolveSurfaceLinkTarget } from "./lib/surfaceLinkTarget.js";
export { authHttpRequest, clearAuthCsrfTokenCache } from "./api/AuthHttpClient.js";
export { useSignOut, createSignOutAction, performSignOutRequest } from "./composables/useSignOut.js";
export {
  createAuthGuardRuntime,
  isAuthGuardRuntime,
  initializeAuthGuardRuntime,
  refreshAuthGuardState,
  getAuthGuardState
} from "./runtime/authGuardRuntime.js";
export { useAuthGuardRuntime, EMPTY_AUTH_GUARD_RUNTIME } from "./runtime/inject.js";
export { AUTH_GUARD_RUNTIME_CLIENT_TOKEN } from "./runtime/tokens.js";

const routeComponents = Object.freeze({
  "auth-login": DefaultLoginView,
  "auth-signout": DefaultSignOutView,
  "auth-default-login": DefaultLoginView
});

const clientProviders = Object.freeze([AuthWebClientProvider]);

export { routeComponents, clientProviders };
