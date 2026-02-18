import { resolveSurfaceFromPathname } from "../shared/routing/surfacePaths.js";
import { DEFAULT_SURFACE_ID, normalizeSurfaceId } from "../shared/routing/surfaceRegistry.js";
import { createAdminRouter } from "./router.admin.js";
import { createCustomerRouter } from "./router.app.js";
import { createGodRouter } from "./router.god.js";
import { createSurfaceRouteGuards, resolveRuntimeState } from "./routerGuards.js";

const ROUTER_BY_SURFACE = {
  app: createCustomerRouter,
  admin: createAdminRouter,
  god: createGodRouter
};

function createRouterForSurface({ authStore, workspaceStore, godStore, surface }) {
  const normalizedSurface = normalizeSurfaceId(surface);
  const createRouter = ROUTER_BY_SURFACE[normalizedSurface] || ROUTER_BY_SURFACE[DEFAULT_SURFACE_ID];
  return createRouter({ authStore, workspaceStore, godStore });
}

function createRouterForCurrentPath({ authStore, workspaceStore, godStore, pathname }) {
  const resolvedPathname =
    typeof pathname === "string" ? pathname : typeof window !== "undefined" ? window.location.pathname : "/";

  return createRouterForSurface({
    authStore,
    workspaceStore,
    godStore,
    surface: resolveSurfaceFromPathname(resolvedPathname)
  });
}

function createAppRouter({ authStore, workspaceStore, godStore, pathname }) {
  return createRouterForCurrentPath({
    authStore,
    workspaceStore,
    godStore,
    pathname
  });
}

export {
  createAdminRouter,
  createAppRouter,
  createCustomerRouter,
  createGodRouter,
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
