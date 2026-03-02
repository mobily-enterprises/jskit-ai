import { createBrowserHistory, createRootRoute, createRouter } from "@tanstack/vue-router";
import { createSurfacePaths } from "../../../shared/surfacePaths.js";
import { createSurfaceRouteGuards } from "./guards.js";
import { createRoutes as createCoreRoutes } from "./routes/coreRoutes.js";
import { createRoutes as createAssistantRoutes } from "./routes/assistantRoutes.js";
import { createRoutes as createChatRoutes } from "./routes/chatRoutes.js";
import { createRoutes as createSocialRoutes } from "./routes/socialRoutes.js";
import { createRoutes as createWorkspaceRoutes } from "./routes/workspaceRoutes.js";
import { createRoutes as createProjectsRoutes } from "./routes/projectsRoutes.js";

function createSurfaceRouter({
  authStore,
  workspaceStore,
  surface,
  shellComponent,
  routeFragments = [],
  guardPolicies = {},
  includeWorkspaceSettings = false,
  includeAssistantRoute = false,
  includeChatRoute = false,
  includeSocialRoute = false,
  includeSocialModerationRoute = false,
  includeChoiceTwoRoute = true
}) {
  const stores = { authStore, workspaceStore };
  const surfacePaths = createSurfacePaths(surface);
  const guards = createSurfaceRouteGuards(stores, {
    loginPath: surfacePaths.loginPath,
    workspacesPath: surfacePaths.workspacesPath,
    workspaceHomePath: (workspaceSlug) => surfacePaths.workspaceHomePath(workspaceSlug),
    guardPolicies
  });

  const rootRoute = createRootRoute({
    component: shellComponent
  });

  const workspaceRoutePrefix = `${surfacePaths.prefix}/w/$workspaceSlug`;

  const routes = createCoreRoutes({
    rootRoute,
    surfacePaths,
    workspaceRoutePrefix,
    guards,
    includeChoiceTwoRoute
  });

  const normalizedRouteFragments = Array.isArray(routeFragments) && routeFragments.length > 0
    ? routeFragments
    : [
        ...(includeAssistantRoute
          ? [
              {
                id: "assistant",
                order: 10,
                createRoutes: createAssistantRoutes,
                options: {}
              }
            ]
          : []),
        ...(includeChatRoute
          ? [
              {
                id: "chat",
                order: 20,
                createRoutes: createChatRoutes,
                options: {}
              }
            ]
          : []),
        ...(includeSocialRoute
          ? [
              {
                id: "social",
                order: 30,
                createRoutes: createSocialRoutes,
                options: {
                  includeModerationRoute: includeSocialModerationRoute
                }
              }
            ]
          : []),
        ...(includeWorkspaceSettings
          ? [
              {
                id: "workspace",
                order: 40,
                createRoutes: createWorkspaceRoutes,
                options: {}
              },
              {
                id: "projects",
                order: 50,
                createRoutes: createProjectsRoutes,
                options: {}
              }
            ]
          : [])
      ];

  let insertIndex = 3;
  const sortedRouteFragments = [...normalizedRouteFragments].sort(
    (left, right) =>
      Number(left?.order || 100) - Number(right?.order || 100) ||
      String(left?.id || "").localeCompare(String(right?.id || ""))
  );

  for (const fragment of sortedRouteFragments) {
    if (!fragment || typeof fragment.createRoutes !== "function") {
      continue;
    }

    const fragmentRoutes = fragment.createRoutes({
      rootRoute,
      workspaceRoutePrefix,
      guards,
      surface,
      ...(fragment.options && typeof fragment.options === "object" ? fragment.options : {})
    });

    routes.splice(insertIndex, 0, ...(Array.isArray(fragmentRoutes) ? fragmentRoutes : []));
    insertIndex += Array.isArray(fragmentRoutes) ? fragmentRoutes.length : 0;
  }

  const routeTree = rootRoute.addChildren(routes);

  return createRouter({
    routeTree,
    history: createBrowserHistory(),
    defaultPreload: "intent"
  });
}

export { createSurfaceRouter };
