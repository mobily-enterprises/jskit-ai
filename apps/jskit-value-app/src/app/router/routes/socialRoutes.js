import { createRoute, lazyRouteComponent, redirect } from "@tanstack/vue-router";

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

function normalizeMountAliases(mountAliases, mountPath) {
  const aliases = [];
  const seen = new Set();
  for (const aliasValue of Array.isArray(mountAliases) ? mountAliases : []) {
    const aliasPath = normalizeMountPath(aliasValue, mountPath);
    if (aliasPath === mountPath || seen.has(aliasPath)) {
      continue;
    }
    seen.add(aliasPath);
    aliases.push(aliasPath);
  }

  return aliases;
}

function createRoutes({
  rootRoute,
  workspaceRoutePrefix,
  guards,
  includeModerationRoute = false,
  mountPath = "/social",
  mountAliases = []
}) {
  const normalizedMountPath = normalizeMountPath(mountPath, "/social");
  const aliasPaths = normalizeMountAliases(mountAliases, normalizedMountPath);
  const routePath = `${workspaceRoutePrefix}${normalizedMountPath}`;
  const moderationRoutePath = `${routePath}/moderation`;
  const routes = [
    createRoute({
      getParentRoute: () => rootRoute,
      path: routePath,
      component: SocialFeedView,
      beforeLoad: (context) => guards.beforeLoadSocial(context)
    }),
    ...aliasPaths.map((aliasPath) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path: `${workspaceRoutePrefix}${aliasPath}`,
        component: SocialFeedView,
        beforeLoad: async (context) => {
          await guards.beforeLoadSocial(context);
          throw redirect({
            to: routePath,
            params: {
              workspaceSlug: context?.params?.workspaceSlug
            },
            replace: true
          });
        }
      })
    )
  ];

  if (includeModerationRoute) {
    routes.push(
      createRoute({
        getParentRoute: () => rootRoute,
        path: moderationRoutePath,
        component: SocialModerationView,
        beforeLoad: (context) => guards.beforeLoadWorkspacePermissionsRequired(context, ["social.moderate"])
      }),
      ...aliasPaths.map((aliasPath) =>
        createRoute({
          getParentRoute: () => rootRoute,
          path: `${workspaceRoutePrefix}${aliasPath}/moderation`,
          component: SocialModerationView,
          beforeLoad: async (context) => {
            await guards.beforeLoadWorkspacePermissionsRequired(context, ["social.moderate"]);
            throw redirect({
              to: moderationRoutePath,
              params: {
                workspaceSlug: context?.params?.workspaceSlug
              },
              replace: true
            });
          }
        })
      )
    );
  }

  return routes;
}

export { createRoutes };
