import { AuthWebClientProvider } from "./providers/AuthWebClientProvider.js";
import DefaultLoginView from "./views/DefaultLoginView.vue";
import DefaultSignOutView from "./views/DefaultSignOutView.vue";

export { AuthWebClientProvider } from "./providers/AuthWebClientProvider.js";
export { default as DefaultLoginView } from "./views/DefaultLoginView.vue";
export { default as DefaultSignOutView } from "./views/DefaultSignOutView.vue";
export { default as AuthProfileWidget } from "./views/AuthProfileWidget.vue";
export { default as AuthProfileMenuLinkItem } from "./views/AuthProfileMenuLinkItem.vue";
export { useAuthStore } from "./stores/useAuthStore.js";
export { useAuthGuardRuntime } from "./runtime/inject.js";
export {
  completeOAuthCallbackFromCurrentLocation,
  completeOAuthCallbackFromUrl,
  readOAuthCallbackParamsFromUrl
} from "./runtime/oauthCallbackRuntime.js";

const routeComponents = Object.freeze({
  "auth-login": DefaultLoginView,
  "auth-signout": DefaultSignOutView,
  "auth-default-login": DefaultLoginView
});

const clientProviders = Object.freeze([AuthWebClientProvider]);

export { routeComponents, clientProviders };
