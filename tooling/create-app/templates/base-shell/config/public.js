export const config = {};
__TENANCY_MODE_LINE__

config.surfaceModeAll = "all";
config.surfaceDefaultId = "app";
config.webRootAllowed = "yes";
config.surfaceDefinitions = {
  app: {
    id: "app",
    prefix: "/",
    enabled: true,
    requiresAuth: false,
    requiresWorkspace: false
  }
};
