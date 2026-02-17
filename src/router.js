import { resolveSurfaceFromPathname } from "../shared/routing/surfacePaths.js";
import { DEFAULT_SURFACE_ID, normalizeSurfaceId } from "../shared/routing/surfaceRegistry.js";
import { createAdminRouter } from "./router.admin";
import { createCustomerRouter } from "./router.app";
import { createSurfaceRouteGuards, resolveRuntimeState } from "./routerGuards";

const ROUTER_BY_SURFACE = {
  app: createCustomerRouter,
  admin: createAdminRouter
};

function createRouterForSurface({ authStore, workspaceStore, surface }) {
  const normalizedSurface = normalizeSurfaceId(surface);
  const createRouter = ROUTER_BY_SURFACE[normalizedSurface] || ROUTER_BY_SURFACE[DEFAULT_SURFACE_ID];
  return createRouter({ authStore, workspaceStore });
}

function createRouterForCurrentPath({ authStore, workspaceStore, pathname }) {
  const resolvedPathname =
    typeof pathname === "string"
      ? pathname
      : typeof window !== "undefined"
        ? window.location.pathname
        : "/";

  return createRouterForSurface({
    authStore,
    workspaceStore,
    surface: resolveSurfaceFromPathname(resolvedPathname)
  });
}

function createAppRouter({ authStore, workspaceStore, pathname }) {
  return createRouterForCurrentPath({
    authStore,
    workspaceStore,
    pathname
  });
}

export { createAdminRouter, createAppRouter, createCustomerRouter, createRouterForSurface, createRouterForCurrentPath };

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
