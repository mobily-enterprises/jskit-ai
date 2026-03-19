import { API_BASE_PATH } from "./apiPaths.js";
import { createSurfacePathHelpers } from "./paths.js";
import { createSurfaceRegistry } from "./registry.js";

const DEFAULT_SURFACES = Object.freeze({
  app: Object.freeze({
    id: "app",
    pagesRoot: ""
  }),
  admin: Object.freeze({
    id: "admin",
    pagesRoot: "admin"
  }),
  console: Object.freeze({
    id: "console",
    pagesRoot: "console"
  })
});

const DEFAULT_ROUTES = Object.freeze({
  loginPath: "/login",
  resetPasswordPath: "/reset-password",
  accountSettingsPath: "/account/settings",
  invitationsPath: "/invitations"
});

function createDefaultAppSurfaceRegistry({ surfaces = DEFAULT_SURFACES, defaultSurfaceId = "app" } = {}) {
  return createSurfaceRegistry({
    surfaces,
    defaultSurfaceId
  });
}

function createDefaultAppSurfacePaths({
  surfaces = DEFAULT_SURFACES,
  defaultSurfaceId = "app",
  routes = DEFAULT_ROUTES
} = {}) {
  const registry = createDefaultAppSurfaceRegistry({
    surfaces,
    defaultSurfaceId
  });

  const helpers = createSurfacePathHelpers({
    apiBasePath: API_BASE_PATH,
    defaultSurfaceId: registry.DEFAULT_SURFACE_ID,
    normalizeSurfaceId: registry.normalizeSurfaceId,
    resolveSurfaceRouteBase: registry.resolveSurfaceRouteBase,
    listSurfaceDefinitions: registry.listSurfaceDefinitions,
    routes
  });

  return Object.freeze({
    ...registry,
    ...helpers,
    SURFACE_APP: "app",
    SURFACE_ADMIN: "admin",
    SURFACE_CONSOLE: "console",
    ADMIN_SURFACE_ROUTE_BASE: registry.resolveSurfaceRouteBase("admin"),
    CONSOLE_SURFACE_ROUTE_BASE: registry.resolveSurfaceRouteBase("console")
  });
}

export { DEFAULT_SURFACES, DEFAULT_ROUTES, createDefaultAppSurfaceRegistry, createDefaultAppSurfacePaths };
