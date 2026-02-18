import { createBrowserHistory, createRootRoute, createRouter } from "@tanstack/vue-router";
import { createSurfacePaths } from "../shared/routing/surfacePaths.js";
import { createSurfaceRouteGuards } from "./routerGuards.js";
import { createRoutes as createCoreRoutes } from "./routes/coreRoutes.js";
import { createRoutes as createWorkspaceRoutes } from "./routes/workspaceRoutes.js";
import { createRoutes as createProjectsRoutes } from "./routes/projectsRoutes.js";

function createSurfaceRouter({ authStore, workspaceStore, surface, shellComponent, includeWorkspaceSettings = false }) {
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
    guards
  });

  if (includeWorkspaceSettings) {
    routes.splice(
      3,
      0,
      ...createWorkspaceRoutes({
        rootRoute,
        workspaceRoutePrefix,
        guards
      }),
      ...createProjectsRoutes({
        rootRoute,
        workspaceRoutePrefix,
        guards
      })
    );
  }

  const routeTree = rootRoute.addChildren(routes);

  return createRouter({
    routeTree,
    history: createBrowserHistory(),
    defaultPreload: "intent"
  });
}

export { createSurfaceRouter };
