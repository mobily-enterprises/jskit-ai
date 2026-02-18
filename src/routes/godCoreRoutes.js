import { createRoute, lazyRouteComponent } from "@tanstack/vue-router";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const LoginView = lazyRouteComponent(() => import("../views/login/LoginView.vue"));
const ResetPasswordView = lazyRouteComponent(() => import("../views/reset-password/ResetPasswordView.vue"));
const AccountSettingsView = lazyRouteComponent(() => import("../views/settings/SettingsView.vue"));
const GodHomeView = lazyRouteComponent(() => import("../views/god/GodHomeView.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

function createRoutes({ rootRoute, surfacePaths, guards }) {
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: surfacePaths.rootPath,
      component: GodHomeView,
      beforeLoad: guards.beforeLoadRoot
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: surfacePaths.accountSettingsPath,
      component: AccountSettingsView,
      beforeLoad: guards.beforeLoadAuthenticated
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: surfacePaths.loginPath,
      component: LoginView,
      beforeLoad: guards.beforeLoadPublic
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: surfacePaths.resetPasswordPath,
      component: ResetPasswordView
    })
  ];
}

export { createRoutes };
