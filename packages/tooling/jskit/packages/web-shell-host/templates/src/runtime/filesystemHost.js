import { DEFAULT_SURFACE_ID, SURFACE_PREFIX_BY_ID, listSurfaceDefinitions } from "./surfaces.generated.js";

const KNOWN_SURFACE_IDS = new Set(listSurfaceDefinitions().map((definition) => definition.id));
const SURFACE_MATCHERS = listSurfaceDefinitions()
  .filter((definition) => String(definition.prefix || "").trim())
  .slice()
  .sort((left, right) => right.prefix.length - left.prefix.length);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePath(pathname) {
  const normalized = normalizeText(pathname);
  if (!normalized || normalized === "/") {
    return "/";
  }

  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return withLeadingSlash.replace(/\/+$/g, "").replace(/\/+/g, "/") || "/";
}

function normalizeSurface(surface) {
  const normalized = normalizeText(surface).toLowerCase();
  if (!KNOWN_SURFACE_IDS.has(normalized)) {
    return DEFAULT_SURFACE_ID;
  }
  return normalized;
}

function resolveSurfaceFromPathname(pathname) {
  const normalizedPath = normalizePath(pathname);
  for (const definition of SURFACE_MATCHERS) {
    const prefix = normalizePath(definition.prefix);
    if (normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)) {
      return definition.id;
    }
  }
  return DEFAULT_SURFACE_ID;
}

function createFilesystemHost(manifest, { surface = "" } = {}) {
  const normalizedSurface = normalizeSurface(surface);
  const filesystemRouteEntries = manifest?.filesystemRouteEntries;
  const shellEntriesBySurface = manifest?.shellEntriesBySurface;

  function listFilesystemRouteEntries() {
    return Array.isArray(filesystemRouteEntries) ? filesystemRouteEntries : [];
  }

  function listShellEntriesBySlot(surfaceOverride) {
    const targetSurface = normalizeSurface(surfaceOverride) || normalizedSurface || DEFAULT_SURFACE_ID;
    const bySurface =
      shellEntriesBySurface && typeof shellEntriesBySurface === "object" ? shellEntriesBySurface : {};
    const bySlot =
      bySurface[targetSurface] && typeof bySurface[targetSurface] === "object" ? bySurface[targetSurface] : {};

    return Object.freeze({
      drawer: Object.freeze(Array.isArray(bySlot.drawer) ? bySlot.drawer : []),
      top: Object.freeze(Array.isArray(bySlot.top) ? bySlot.top : []),
      config: Object.freeze(Array.isArray(bySlot.config) ? bySlot.config : [])
    });
  }

  return Object.freeze({
    listFilesystemRouteEntries,
    listShellEntriesBySlot,
    resolveSurfaceFromPathname
  });
}

export { createFilesystemHost, resolveSurfaceFromPathname };
