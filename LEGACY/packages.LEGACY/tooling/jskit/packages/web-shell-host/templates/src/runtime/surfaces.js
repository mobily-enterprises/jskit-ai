const SURFACE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "app",
    prefix: "/app",
    surfaceFile: "surface.app.js"
  }),
  Object.freeze({
    id: "admin",
    prefix: "/admin",
    surfaceFile: "surface.admin.js"
  }),
  Object.freeze({
    id: "console",
    prefix: "/console",
    surfaceFile: "surface.console.js"
  })
]);

const DEFAULT_SURFACE_ID = "app";

const SURFACE_PREFIX_BY_ID = Object.freeze(
  Object.fromEntries(SURFACE_DEFINITIONS.map((definition) => [definition.id, definition.prefix]))
);

function listSurfaceDefinitions() {
  return SURFACE_DEFINITIONS;
}

function findSurfaceDefinition(surfaceId) {
  const normalized = String(surfaceId || "").trim().toLowerCase();
  return SURFACE_DEFINITIONS.find((definition) => definition.id === normalized) || null;
}

export { DEFAULT_SURFACE_ID, SURFACE_DEFINITIONS, SURFACE_PREFIX_BY_ID, listSurfaceDefinitions, findSurfaceDefinition };
