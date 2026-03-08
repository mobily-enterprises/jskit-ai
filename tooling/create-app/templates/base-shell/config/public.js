export const config = {};

config.surfaceModeAll = "all";
config.surfaceDefaultId = "app";
config.webRootAllowed = "yes";
config.surfaceDefinitions = {
  app: {
    id: "app",
    prefix: "/app",
    enabled: true,
    requiresAuth: false,
    requiresWorkspace: false
  },
  admin: {
    id: "admin",
    prefix: "/admin",
    enabled: true,
    requiresAuth: false,
    requiresWorkspace: false
  },
  console: {
    id: "console",
    prefix: "/console",
    enabled: true,
    requiresAuth: false,
    requiresWorkspace: false
  }
};
