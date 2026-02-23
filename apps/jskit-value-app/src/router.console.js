import { createBrowserHistory, createRootRoute, createRouter } from "@tanstack/vue-router";
import { createSurfacePaths } from "../shared/routing/surfacePaths.js";
import ConsoleShell from "./shells/console/ConsoleShell.vue";
import { createConsoleRouteGuards } from "./routerGuards.console.js";
import { createRoutes as createConsoleCoreRoutes } from "./routes/consoleCoreRoutes.js";

function createConsoleRouter({ authStore, workspaceStore, consoleStore }) {
  const stores = { authStore, workspaceStore, consoleStore };
  const surfacePaths = createSurfacePaths("console");
  const appSurfacePaths = createSurfacePaths("app");
  const guards = createConsoleRouteGuards(stores, {
    loginPath: surfacePaths.loginPath,
    rootPath: surfacePaths.rootPath,
    invitationsPath: surfacePaths.invitationsPath,
    fallbackPath: appSurfacePaths.rootPath
  });

  const rootRoute = createRootRoute({
    component: ConsoleShell
  });

  const routeTree = rootRoute.addChildren(
    createConsoleCoreRoutes({
      rootRoute,
      surfacePaths,
      guards
    })
  );

  return createRouter({
    routeTree,
    history: createBrowserHistory(),
    defaultPreload: "intent"
  });
}

export { createConsoleRouter };
