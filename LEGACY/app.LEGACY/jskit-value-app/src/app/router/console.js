import { createBrowserHistory, createRootRoute, createRouter } from "@tanstack/vue-router";
import { createSurfacePaths } from "../../../shared/surfacePaths.js";
import ConsoleShell from "../shells/console/ConsoleShell.vue";
import { createConsoleRouteGuards } from "./guards.console.js";
import { createRoutes as createConsoleCoreRoutes } from "./routes/consoleCoreRoutes.js";
import { composeSurfaceRouteFragments } from "../../framework/composeRouter.js";

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

  const routeFragments = composeSurfaceRouteFragments("console");
  const normalizedRouteFragments =
    routeFragments.length > 0
      ? routeFragments
      : [
          {
            id: "core",
            order: 0,
            createRoutes: createConsoleCoreRoutes,
            options: {}
          }
        ];

  const routeChildren = [];
  const sortedFragments = [...normalizedRouteFragments].sort(
    (left, right) =>
      Number(left?.order || 100) - Number(right?.order || 100) ||
      String(left?.id || "").localeCompare(String(right?.id || ""))
  );

  for (const fragment of sortedFragments) {
    if (!fragment || typeof fragment.createRoutes !== "function") {
      continue;
    }

    const fragmentRoutes = fragment.createRoutes({
      rootRoute,
      surfacePaths,
      guards,
      ...(fragment.options && typeof fragment.options === "object" ? fragment.options : {})
    });
    routeChildren.push(...(Array.isArray(fragmentRoutes) ? fragmentRoutes : []));
  }

  const routeTree = rootRoute.addChildren(routeChildren);

  return createRouter({
    routeTree,
    history: createBrowserHistory(),
    defaultPreload: "intent"
  });
}

export { createConsoleRouter };
