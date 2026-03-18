export const config = {};

config.tenancyMode = "__TENANCY_MODE__";
config.surfaceModeAll = "all";
config.surfaceDefaultId = "app";
config.webRootAllowed = "yes";
config.surfaceDefinitions = {
  app: {
    id: "app",
    prefix: "/",
    enabled: true,
    requiresAuth: false,
    requiresWorkspace: __APP_REQUIRES_WORKSPACE__
  }
};
