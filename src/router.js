import { createBrowserHistory, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/vue-router";
import App from "./App.vue";
import LoginView from "./views/LoginView.vue";
import CalculatorView from "./views/CalculatorView.vue";
import ResetPasswordView from "./views/ResetPasswordView.vue";

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

export function createAppRouter(authStore) {
  const rootRoute = createRootRoute({
    component: App
  });

  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: LoginView,
    beforeLoad: async () => {
      const state = await resolveAuthState(authStore);
      if (state.sessionUnavailable) {
        return;
      }
      if (state.authenticated) {
        throw redirect({ to: "/" });
      }
    }
  });

  const calculatorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: CalculatorView,
    beforeLoad: async () => {
      const state = await resolveAuthState(authStore);
      if (state.sessionUnavailable) {
        return;
      }
      if (!state.authenticated) {
        throw redirect({ to: "/login" });
      }
    }
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
