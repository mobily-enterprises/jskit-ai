import { createRoute, lazyRouteComponent } from "@tanstack/vue-router";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const LoginView = lazyRouteComponent(() => import("../../../views/login/LoginView.vue"));
const ResetPasswordView = lazyRouteComponent(() => import("../../../views/reset-password/ResetPasswordView.vue"));
const AccountSettingsView = lazyRouteComponent(() => import("../../../views/settings/SettingsView.vue"));
const ConsoleHomeView = lazyRouteComponent(() => import("../../../views/console/ConsoleHomeView.vue"));
const ConsoleMembersView = lazyRouteComponent(() => import("../../../views/console/ConsoleMembersView.vue"));
const ConsoleInvitationsView = lazyRouteComponent(() => import("../../../views/console/ConsoleInvitationsView.vue"));
const ConsoleBrowserErrorsView = lazyRouteComponent(() => import("../../../views/console/ConsoleBrowserErrorsView.vue"));
const ConsoleBrowserErrorDetailView = lazyRouteComponent(
  () => import("../../../views/console/ConsoleBrowserErrorDetailView.vue")
);
const ConsoleServerErrorsView = lazyRouteComponent(() => import("../../../views/console/ConsoleServerErrorsView.vue"));
const ConsoleServerErrorDetailView = lazyRouteComponent(
  () => import("../../../views/console/ConsoleServerErrorDetailView.vue")
);
const ConsoleAiTranscriptsView = lazyRouteComponent(() => import("../../../views/console/ConsoleAiTranscriptsView.vue"));
const ConsoleBillingEventsView = lazyRouteComponent(() => import("../../../views/console/ConsoleBillingEventsView.vue"));
const ConsoleBillingPlansView = lazyRouteComponent(() => import("../../../views/console/ConsoleBillingPlansView.vue"));
const ConsoleBillingProductsView = lazyRouteComponent(() => import("../../../views/console/ConsoleBillingProductsView.vue"));
const ConsoleBillingEntitlementsView = lazyRouteComponent(
  () => import("../../../views/console/ConsoleBillingEntitlementsView.vue")
);
const ConsoleBillingPurchasesView = lazyRouteComponent(() => import("../../../views/console/ConsoleBillingPurchasesView.vue"));
const ConsoleBillingPlanAssignmentsView = lazyRouteComponent(
  () => import("../../../views/console/ConsoleBillingPlanAssignmentsView.vue")
);
const ConsoleBillingSubscriptionsView = lazyRouteComponent(
  () => import("../../../views/console/ConsoleBillingSubscriptionsView.vue")
);
const AlertsView = lazyRouteComponent(() => import("../../../views/alerts/AlertsView.vue"));
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
      path: `${surfacePaths.prefix}/alerts`,
      component: AlertsView,
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
      path: `${surfacePaths.prefix}/transcripts`,
      component: ConsoleAiTranscriptsView,
      beforeLoad: guards.beforeLoadAiTranscripts
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${surfacePaths.prefix}/billing/events`,
      component: ConsoleBillingEventsView,
      beforeLoad: guards.beforeLoadBillingEvents
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${surfacePaths.prefix}/billing/plans`,
      component: ConsoleBillingPlansView,
      beforeLoad: guards.beforeLoadBillingPlans
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${surfacePaths.prefix}/billing/products`,
      component: ConsoleBillingProductsView,
      beforeLoad: guards.beforeLoadBillingPlans
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${surfacePaths.prefix}/billing/entitlements`,
      component: ConsoleBillingEntitlementsView,
      beforeLoad: guards.beforeLoadBillingEntitlements
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${surfacePaths.prefix}/billing/purchases`,
      component: ConsoleBillingPurchasesView,
      beforeLoad: guards.beforeLoadBillingPurchases
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${surfacePaths.prefix}/billing/plan-assignments`,
      component: ConsoleBillingPlanAssignmentsView,
      beforeLoad: guards.beforeLoadBillingPlanAssignments
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${surfacePaths.prefix}/billing/subscriptions`,
      component: ConsoleBillingSubscriptionsView,
      beforeLoad: guards.beforeLoadBillingSubscriptions
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
