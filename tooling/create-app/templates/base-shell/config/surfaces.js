const SURFACE_MODE_ALL = "all";
const SURFACE_DEFAULT_ID = "app";
const WEB_ROOT_ALLOWED = "yes";

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

export { SURFACE_MODE_ALL, SURFACE_DEFAULT_ID, SURFACE_DEFINITIONS, WEB_ROOT_ALLOWED };
