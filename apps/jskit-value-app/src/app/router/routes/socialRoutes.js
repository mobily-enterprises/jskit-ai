import { createRoute, lazyRouteComponent } from "@tanstack/vue-router";

/* c8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
/* v8 ignore start -- lazy Vue SFC loaders require full Vite CSS handling and are exercised in browser/E2E paths. */
const SocialFeedView = lazyRouteComponent(() => import("../../../views/social/SocialFeedView.vue"));
const SocialModerationView = lazyRouteComponent(() => import("../../../views/social/SocialModerationView.vue"));
/* v8 ignore stop */
/* c8 ignore stop */

function normalizeMountPath(pathValue, fallbackPath = "/social") {
  const normalized = String(pathValue || "").trim();
  const source = normalized || fallbackPath;
  const withLeadingSlash = source.startsWith("/") ? source : `/${source}`;
  const squashed = withLeadingSlash.replace(/\/+/g, "/");
  if (squashed.length > 1 && squashed.endsWith("/")) {
    return squashed.slice(0, -1);
  }

  return squashed || fallbackPath;
}

function createRoutes({
  rootRoute,
  workspaceRoutePrefix,
  guards,
  includeModerationRoute = false,
  mountPath = "/social"
}) {
  const normalizedMountPath = normalizeMountPath(mountPath, "/social");
  const routePath = `${workspaceRoutePrefix}${normalizedMountPath}`;
  const moderationRoutePath = `${routePath}/moderation`;
  const routes = [
    createRoute({
      getParentRoute: () => rootRoute,
      path: routePath,
      component: SocialFeedView,
      beforeLoad: (context) => guards.beforeLoadSocial(context)
    })
  ];

  if (includeModerationRoute) {
    routes.push(
      createRoute({
        getParentRoute: () => rootRoute,
        path: moderationRoutePath,
        component: SocialModerationView,
        beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, ["social.moderate"])
      })
    );
  }

  return routes;
}

export { createRoutes };
