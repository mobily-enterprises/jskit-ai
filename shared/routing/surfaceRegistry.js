const SURFACE_REGISTRY = Object.freeze({
  app: Object.freeze({
    id: "app",
    prefix: ""
  }),
  admin: Object.freeze({
    id: "admin",
    prefix: "/admin"
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

function listSurfaceDefinitions() {
  return Object.values(SURFACE_REGISTRY);
}

export { SURFACE_REGISTRY, DEFAULT_SURFACE_ID, normalizeSurfaceId, resolveSurfacePrefix, listSurfaceDefinitions };
