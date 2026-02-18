const SURFACE_REGISTRY = Object.freeze({
  app: Object.freeze({
    id: "app",
    prefix: "",
    requiresWorkspace: true
  }),
  admin: Object.freeze({
    id: "admin",
    prefix: "/admin",
    requiresWorkspace: true
  }),
  god: Object.freeze({
    id: "god",
    prefix: "/god",
    requiresWorkspace: false
  })
});

const DEFAULT_SURFACE_ID = "app";

function normalizeSurfaceId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (SURFACE_REGISTRY[normalized]) {
    return normalized;
  }

  return DEFAULT_SURFACE_ID;
}

function resolveSurfacePrefix(surfaceId) {
  return SURFACE_REGISTRY[normalizeSurfaceId(surfaceId)]?.prefix || "";
}

function surfaceRequiresWorkspace(surfaceId) {
  return Boolean(SURFACE_REGISTRY[normalizeSurfaceId(surfaceId)]?.requiresWorkspace);
}

function listSurfaceDefinitions() {
  return Object.values(SURFACE_REGISTRY);
}

export {
  SURFACE_REGISTRY,
  DEFAULT_SURFACE_ID,
  normalizeSurfaceId,
  resolveSurfacePrefix,
  surfaceRequiresWorkspace,
  listSurfaceDefinitions
};
