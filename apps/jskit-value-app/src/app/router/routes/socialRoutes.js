import { createRoute, lazyRouteComponent } from "@tanstack/vue-router";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const SocialFeedView = lazyRouteComponent(() => import("../../../views/social/SocialFeedView.vue"));
const SocialModerationView = lazyRouteComponent(() => import("../../../views/social/SocialModerationView.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

function createRoutes({ rootRoute, workspaceRoutePrefix, guards, includeModerationRoute = false }) {
  const routes = [
    createRoute({
      getParentRoute: () => rootRoute,
      path: `${workspaceRoutePrefix}/social`,
      component: SocialFeedView,
      beforeLoad: (context) => guards.beforeLoadSocial(context)
    })
  ];

  if (includeModerationRoute) {
    routes.push(
      createRoute({
        getParentRoute: () => rootRoute,
        path: `${workspaceRoutePrefix}/social/moderation`,
        component: SocialModerationView,
        beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, ["social.moderate"])
      })
    );
  }

  return routes;
}

export { createRoutes };
