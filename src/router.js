import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect
} from "@tanstack/vue-router";
import App from "./App.vue";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const LoginView = lazyRouteComponent(() => import("./views/LoginView.vue"));
const CalculatorView = lazyRouteComponent(() => import("./views/CalculatorView.vue"));
const ResetPasswordView = lazyRouteComponent(() => import("./views/ResetPasswordView.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

async function resolveAuthState(authStore) {
  let authenticated = authStore.isAuthenticated;
  let sessionUnavailable = false;

  try {
    const session = await authStore.ensureSession();
    authenticated = Boolean(session?.authenticated);
  } catch (error) {
    if (error?.status === 503) {
      sessionUnavailable = true;
    } else {
      authStore.setSignedOut();
      authenticated = false;
    }
  }

  return {
    authenticated,
    sessionUnavailable
  };
}

async function beforeLoadLogin(authStore) {
  const state = await resolveAuthState(authStore);
  if (state.sessionUnavailable) {
    return;
  }
  if (state.authenticated) {
    throw redirect({ to: "/" });
  }
}

async function beforeLoadCalculator(authStore) {
  const state = await resolveAuthState(authStore);
  if (state.sessionUnavailable) {
    return;
  }
  if (!state.authenticated) {
    throw redirect({ to: "/login" });
  }
}

export function createAppRouter(authStore) {
  const rootRoute = createRootRoute({
    component: App
  });

  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: LoginView,
    beforeLoad: beforeLoadLogin.bind(null, authStore)
  });

  const calculatorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: CalculatorView,
    beforeLoad: beforeLoadCalculator.bind(null, authStore)
  });

  const resetPasswordRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reset-password",
    component: ResetPasswordView
  });

  const routeTree = rootRoute.addChildren([calculatorRoute, loginRoute, resetPasswordRoute]);

  return createRouter({
    routeTree,
    history: createBrowserHistory(),
    defaultPreload: "intent"
  });
}

export const __testables = {
  resolveAuthState,
  beforeLoadLogin,
  beforeLoadCalculator
};
