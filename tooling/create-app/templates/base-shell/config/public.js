export const config = {};
__TENANCY_MODE_LINE__

config.surfaceModeAll = "all";
config.surfaceDefaultId = "app";
config.webRootAllowed = "yes";
config.surfaceDefinitions = {};
config.surfaceDefinitions.app = {
  id: "app",
  prefix: "/",
  enabled: true,
  requiresAuth: __APP_SURFACE_REQUIRES_AUTH__,
  requiresWorkspace: __APP_SURFACE_REQUIRES_WORKSPACE__
};
