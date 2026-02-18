import { resolveSurfaceFromPathname } from "../shared/routing/surfacePaths.js";
import { DEFAULT_SURFACE_ID, normalizeSurfaceId } from "../shared/routing/surfaceRegistry.js";
import { createAdminRouter } from "./router.admin.js";
import { createCustomerRouter } from "./router.app.js";
import { createConsoleRouter } from "./router.console.js";
import { createSurfaceRouteGuards, resolveRuntimeState } from "./routerGuards.js";

const ROUTER_BY_SURFACE = {
  app: createCustomerRouter,
  admin: createAdminRouter,
  console: createConsoleRouter
};

function createRouterForSurface({ authStore, workspaceStore, consoleStore, surface }) {
  const normalizedSurface = normalizeSurfaceId(surface);
  const createRouter = ROUTER_BY_SURFACE[normalizedSurface] || ROUTER_BY_SURFACE[DEFAULT_SURFACE_ID];
  return createRouter({ authStore, workspaceStore, consoleStore });
}

function createRouterForCurrentPath({ authStore, workspaceStore, consoleStore, pathname }) {
  const resolvedPathname =
    typeof pathname === "string" ? pathname : typeof window !== "undefined" ? window.location.pathname : "/";

  return createRouterForSurface({
    authStore,
    workspaceStore,
    consoleStore,
    surface: resolveSurfaceFromPathname(resolvedPathname)
  });
}

function createAppRouter({ authStore, workspaceStore, consoleStore, pathname }) {
  return createRouterForCurrentPath({
    authStore,
    workspaceStore,
    consoleStore,
    pathname
  });
}

export {
  createAdminRouter,
  createAppRouter,
  createCustomerRouter,
  createConsoleRouter,
  createRouterForSurface,
  createRouterForCurrentPath
};

function createAdminGuards(stores) {
  return createSurfaceRouteGuards(stores, {
    loginPath: "/login",
    workspacesPath: "/workspaces",
    workspaceHomePath: (workspaceSlug) => `/w/${workspaceSlug}`
  });
}

export const __testables = {
  resolveRuntimeState,
  beforeLoadRoot(stores) {
    return createAdminGuards(stores).beforeLoadRoot();
  },
  beforeLoadPublic(stores) {
    return createAdminGuards(stores).beforeLoadPublic();
  },
  beforeLoadAuthenticatedNoWorkspace(stores) {
    return createAdminGuards(stores).beforeLoadAuthenticatedNoWorkspace();
  },
  beforeLoadAuthenticated(stores) {
    return createAdminGuards(stores).beforeLoadAuthenticated();
  },
  beforeLoadWorkspaceRequired(stores, context) {
    return createAdminGuards(stores).beforeLoadWorkspaceRequired(context);
  }
};
