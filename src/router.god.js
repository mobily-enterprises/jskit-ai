import { createBrowserHistory, createRootRoute, createRouter } from "@tanstack/vue-router";
import { createSurfacePaths } from "../shared/routing/surfacePaths.js";
import GodShell from "./shells/god/GodShell.vue";
import { createGodRouteGuards } from "./routerGuards.god.js";
import { createRoutes as createGodCoreRoutes } from "./routes/godCoreRoutes.js";

function createGodRouter({ authStore, workspaceStore, godStore }) {
  const stores = { authStore, workspaceStore, godStore };
  const surfacePaths = createSurfacePaths("god");
  const appSurfacePaths = createSurfacePaths("app");
  const guards = createGodRouteGuards(stores, {
    loginPath: surfacePaths.loginPath,
    rootPath: surfacePaths.rootPath,
    invitationsPath: surfacePaths.invitationsPath,
    fallbackPath: appSurfacePaths.rootPath
  });

  const rootRoute = createRootRoute({
    component: GodShell
  });

  const routeTree = rootRoute.addChildren(
    createGodCoreRoutes({
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

export { createGodRouter };
