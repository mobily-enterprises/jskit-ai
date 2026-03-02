const SURFACE_MODE_ALL = "all";
const SURFACE_IDS = ["app", "admin", "console"];

const SURFACE_DEFINITIONS = {
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

export { SURFACE_MODE_ALL, SURFACE_IDS, SURFACE_DEFINITIONS };
