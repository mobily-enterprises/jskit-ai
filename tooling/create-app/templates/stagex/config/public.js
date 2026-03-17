export const config = {};

config.tenancyMode = "none";
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
