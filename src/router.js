import { resolveSurfaceFromPathname } from "../shared/routing/surfacePaths.js";
import { createAdminRouter, createAppRouter } from "./router.admin";
import { createCustomerRouter } from "./router.app";
import { createSurfaceRouteGuards, resolveRuntimeState } from "./routerGuards";

function createRouterForSurface({ authStore, workspaceStore, surface }) {
  if (String(surface || "").trim() === "app") {
    return createCustomerRouter({ authStore, workspaceStore });
  }

  return createAdminRouter({ authStore, workspaceStore });
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
