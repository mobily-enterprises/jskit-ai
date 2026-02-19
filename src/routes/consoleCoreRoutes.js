import { createRoute, lazyRouteComponent } from "@tanstack/vue-router";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const LoginView = lazyRouteComponent(() => import("../views/login/LoginView.vue"));
const ResetPasswordView = lazyRouteComponent(() => import("../views/reset-password/ResetPasswordView.vue"));
const AccountSettingsView = lazyRouteComponent(() => import("../views/settings/SettingsView.vue"));
const ConsoleHomeView = lazyRouteComponent(() => import("../views/console/ConsoleHomeView.vue"));
const ConsoleMembersView = lazyRouteComponent(() => import("../views/console/ConsoleMembersView.vue"));
const ConsoleInvitationsView = lazyRouteComponent(() => import("../views/console/ConsoleInvitationsView.vue"));
const ConsoleBrowserErrorsView = lazyRouteComponent(() => import("../views/console/ConsoleBrowserErrorsView.vue"));
const ConsoleBrowserErrorDetailView = lazyRouteComponent(
  () => import("../views/console/ConsoleBrowserErrorDetailView.vue")
);
const ConsoleServerErrorsView = lazyRouteComponent(() => import("../views/console/ConsoleServerErrorsView.vue"));
const ConsoleServerErrorDetailView = lazyRouteComponent(
  () => import("../views/console/ConsoleServerErrorDetailView.vue")
);
/* v8 ignore stop */
/* c8 ignore stop */

function createRoutes({ rootRoute, surfacePaths, guards }) {
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: surfacePaths.rootPath,
      component: ConsoleHomeView,
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
      path: `${surfacePaths.prefix}/members`,
      component: ConsoleMembersView,
      beforeLoad: guards.beforeLoadMembers
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${surfacePaths.prefix}/errors/browser`,
      component: ConsoleBrowserErrorsView,
      beforeLoad: guards.beforeLoadBrowserErrors
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${surfacePaths.prefix}/errors/browser/$errorId`,
      component: ConsoleBrowserErrorDetailView,
      beforeLoad: guards.beforeLoadBrowserErrorDetails
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${surfacePaths.prefix}/errors/server`,
      component: ConsoleServerErrorsView,
      beforeLoad: guards.beforeLoadServerErrors
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${surfacePaths.prefix}/errors/server/$errorId`,
      component: ConsoleServerErrorDetailView,
      beforeLoad: guards.beforeLoadServerErrorDetails
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: surfacePaths.invitationsPath,
      component: ConsoleInvitationsView,
      beforeLoad: guards.beforeLoadInvitations
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
