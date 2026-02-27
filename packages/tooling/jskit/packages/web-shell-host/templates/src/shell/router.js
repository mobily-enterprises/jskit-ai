import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent
} from "@tanstack/vue-router";
import ShellHost from "./ShellHost.vue";
import { listFilesystemRouteEntries } from "./filesystemHost.js";
import { createBeforeLoadFromGuard } from "./guardRuntime.js";

function createShellRouter() {
  const rootRoute = createRootRoute({
    component: ShellHost
  });

  const claimedPaths = new Set();
  const filesystemRoutes = listFilesystemRouteEntries().map((entry) => {
    if (claimedPaths.has(entry.fullPath)) {
      throw new Error(`Duplicate filesystem route path \"${entry.fullPath}\".`);
    }
    claimedPaths.add(entry.fullPath);

    const beforeLoad = createBeforeLoadFromGuard(entry.guard);

    return createRoute({
      getParentRoute: () => rootRoute,
      path: entry.fullPath,
      component: lazyRouteComponent(entry.loadModule),
      ...(typeof beforeLoad === "function" ? { beforeLoad } : {})
    });
  });

  const routeTree = rootRoute.addChildren(filesystemRoutes);

  return createRouter({
    routeTree,
    history: createBrowserHistory(),
    defaultPreload: "intent"
  });
}

export { createShellRouter };
