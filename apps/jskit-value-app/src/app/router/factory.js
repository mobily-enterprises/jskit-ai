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
    workspaceHomePath: (workspaceSlug) => surfacePaths.workspaceHomePath(workspaceSlug)
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

  let insertIndex = 3;

  if (includeAssistantRoute) {
    const assistantRoutes = createAssistantRoutes({
      rootRoute,
      workspaceRoutePrefix,
      guards
    });
    routes.splice(
      insertIndex,
      0,
      ...assistantRoutes
    );
    insertIndex += assistantRoutes.length;
  }

  if (includeChatRoute) {
    const chatRoutes = createChatRoutes({
      rootRoute,
      workspaceRoutePrefix,
      guards,
      surface
    });
    routes.splice(
      insertIndex,
      0,
      ...chatRoutes
    );
    insertIndex += chatRoutes.length;
  }

  if (includeSocialRoute) {
    const socialRoutes = createSocialRoutes({
      rootRoute,
      workspaceRoutePrefix,
      guards,
      includeModerationRoute: includeSocialModerationRoute
    });
    routes.splice(
      insertIndex,
      0,
      ...socialRoutes
    );
    insertIndex += socialRoutes.length;
  }

  if (includeWorkspaceSettings) {
    const workspaceRoutes = createWorkspaceRoutes({
      rootRoute,
      workspaceRoutePrefix,
      guards
    });
    const projectRoutes = createProjectsRoutes({
      rootRoute,
      workspaceRoutePrefix,
      guards
    });
    routes.splice(
      insertIndex,
      0,
      ...workspaceRoutes,
      ...projectRoutes
    );
    insertIndex += workspaceRoutes.length + projectRoutes.length;
  }

  const routeTree = rootRoute.addChildren(routes);

  return createRouter({
    routeTree,
    history: createBrowserHistory(),
    defaultPreload: "intent"
  });
}

export { createSurfaceRouter };
