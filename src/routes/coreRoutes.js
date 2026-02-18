import { createRoute, lazyRouteComponent } from "@tanstack/vue-router";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const LoginView = lazyRouteComponent(() => import("../views/login/LoginView.vue"));
const AnnuityCalculatorView = lazyRouteComponent(() => import("../views/annuity-calculator/AnnuityCalculatorView.vue"));
const ChoiceTwoView = lazyRouteComponent(() => import("../views/choice-two/ChoiceTwoView.vue"));
const ResetPasswordView = lazyRouteComponent(() => import("../views/reset-password/ResetPasswordView.vue"));
const AccountSettingsView = lazyRouteComponent(() => import("../views/settings/SettingsView.vue"));
const WorkspacesView = lazyRouteComponent(() => import("../views/workspaces/WorkspacesView.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

function createCoreRoutes({ rootRoute, surfacePaths, workspaceRoutePrefix, guards }) {
  const rootRedirectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: surfacePaths.rootPath,
    component: AnnuityCalculatorView,
    beforeLoad: guards.beforeLoadRoot
  });

  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: surfacePaths.loginPath,
    component: LoginView,
    beforeLoad: guards.beforeLoadPublic
  });

  const resetPasswordRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: surfacePaths.resetPasswordPath,
    component: ResetPasswordView
  });

  const workspacesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: surfacePaths.workspacesPath,
    component: WorkspacesView,
    beforeLoad: guards.beforeLoadAuthenticatedNoWorkspace
  });

  const calculatorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: workspaceRoutePrefix,
    component: AnnuityCalculatorView,
    beforeLoad: guards.beforeLoadWorkspaceRequired
  });

  const choiceTwoRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: `${workspaceRoutePrefix}/choice-2`,
    component: ChoiceTwoView,
    beforeLoad: guards.beforeLoadWorkspaceRequired
  });

  const accountSettingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: surfacePaths.accountSettingsPath,
    component: AccountSettingsView,
    beforeLoad: guards.beforeLoadAuthenticated
  });

  return [
    rootRedirectRoute,
    calculatorRoute,
    choiceTwoRoute,
    accountSettingsRoute,
    workspacesRoute,
    loginRoute,
    resetPasswordRoute
  ];
}

export { createCoreRoutes };
