export const config = {};

config.surfaceModeAll = "all";
config.surfaceDefaultId = "app";
config.webRootAllowed = "yes";
config.surfaceDefinitions = {
  app: {
    id: "app",
    prefix: "/app",
    enabled: true,
    requiresAuth: false
  },
  admin: {
    id: "admin",
    prefix: "/admin",
    enabled: true,
    requiresAuth: false
  },
  console: {
    id: "console",
    prefix: "/console",
    enabled: true,
    requiresAuth: false
  }
};
