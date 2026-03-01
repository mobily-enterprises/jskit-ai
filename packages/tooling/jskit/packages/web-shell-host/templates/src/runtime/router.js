import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect
} from "@tanstack/vue-router";
import { createBeforeLoadFromGuard } from "./guardRuntime.js";

function resolveLazyRoutes(lazyRoutes) {
  if (typeof lazyRoutes === "boolean") {
    return lazyRoutes;
  }
  const raw = String(import.meta.env?.VITE_WEB_SHELL_LAZY || "").trim().toLowerCase();
  if (!raw) {
    return true;
  }
  if (["0", "false", "off", "no"].includes(raw)) {
    return false;
  }
  return true;
}

function createShellRouter({
  shellComponent,
  listFilesystemRouteEntries,
  redirectFromRootTo = "",
  publicRoutes = []
} = {}) {
  if (typeof listFilesystemRouteEntries !== "function") {
    throw new Error("createShellRouter requires listFilesystemRouteEntries.");
  }
  if (!shellComponent) {
    throw new Error("createShellRouter requires shellComponent.");
  }
  const rootRoute = createRootRoute({
    component: shellComponent
  });

  const lazyRoutes = resolveLazyRoutes();
  const claimedPaths = new Set();
  const filesystemRoutes = listFilesystemRouteEntries().map((entry) => {
    if (claimedPaths.has(entry.fullPath)) {
      throw new Error(`Duplicate filesystem route path \"${entry.fullPath}\".`);
    }
    claimedPaths.add(entry.fullPath);

    const beforeLoad = createBeforeLoadFromGuard(entry.guard);

    const hasLazyLoader = typeof entry.loadModule === "function";
    const hasEagerComponent = typeof entry.component !== "undefined";
    if (!hasLazyLoader && !hasEagerComponent) {
      throw new Error(`Route "${entry.fullPath}" has no component loader.`);
    }

    const useLazyLoader = hasLazyLoader && (lazyRoutes || !hasEagerComponent);
    const routeComponent = useLazyLoader ? lazyRouteComponent(entry.loadModule) : entry.component;

    return createRoute({
      getParentRoute: () => rootRoute,
      path: entry.fullPath,
      component: routeComponent,
      ...(typeof beforeLoad === "function" ? { beforeLoad } : {})
    });
  });

  const staticPublicRoutes = Array.isArray(publicRoutes) ? publicRoutes : [];
  const publicRouteEntries = staticPublicRoutes.map((entry, index) => {
    const path = String(entry?.path || "").trim();
    if (!path) {
      throw new Error(`Public route at index ${index} is missing a path.`);
    }
    if (claimedPaths.has(path)) {
      throw new Error(`Duplicate public route path "${path}".`);
    }
    claimedPaths.add(path);

    const component = entry?.component;
    if (!component) {
      throw new Error(`Public route "${path}" is missing a component.`);
    }

    const beforeLoad = typeof entry.beforeLoad === "function" ? entry.beforeLoad : undefined;

    return createRoute({
      getParentRoute: () => rootRoute,
      path,
      component,
      ...(beforeLoad ? { beforeLoad } : {})
    });
  });

  const redirectTarget = String(redirectFromRootTo || "").trim();
  const rootAlreadyClaimed = claimedPaths.has("/");
  const redirectRoute =
    redirectTarget && !rootAlreadyClaimed
      ? [
          createRoute({
            getParentRoute: () => rootRoute,
            path: "/",
            beforeLoad: () => {
              throw redirect({ to: redirectTarget });
            }
          })
        ]
      : [];

  const routeTree = rootRoute.addChildren([...filesystemRoutes, ...publicRouteEntries, ...redirectRoute]);

  return createRouter({
    routeTree,
    history: createBrowserHistory(),
    defaultPreload: "intent"
  });
}

export { createShellRouter };
