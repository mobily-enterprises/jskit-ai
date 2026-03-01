import { DEFAULT_SURFACE_ID, listSurfaceDefinitions } from "./runtime/surfaces.js";

const SURFACE_LOADERS = Object.freeze({
  app: () => import("./surface.app.js"),
  admin: () => import("./surface.admin.js"),
  console: () => import("./surface.console.js")
});

function normalizePath(pathname) {
  const normalized = String(pathname || "").trim();
  if (!normalized) {
    return "/";
  }
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const squashed = withLeadingSlash.replace(/\/+/g, "/");
  if (squashed.length > 1 && squashed.endsWith("/")) {
    return squashed.slice(0, -1);
  }
  return squashed;
}

function resolveSurfaceId(pathname) {
  const normalizedPath = normalizePath(pathname);
  const orderedDefinitions = listSurfaceDefinitions()
    .filter((definition) => String(definition?.prefix || "").trim())
    .slice()
    .sort((left, right) => String(right.prefix).length - String(left.prefix).length);

  for (const definition of orderedDefinitions) {
    const prefix = normalizePath(definition.prefix);
    if (normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)) {
      return String(definition.id || "").trim().toLowerCase();
    }
  }

  return String(DEFAULT_SURFACE_ID || "").trim().toLowerCase();
}

const pathname = typeof window === "object" && window?.location ? window.location.pathname : "/";
const resolvedSurfaceId = resolveSurfaceId(pathname);
const loadSurface = SURFACE_LOADERS[resolvedSurfaceId] || SURFACE_LOADERS[DEFAULT_SURFACE_ID] || SURFACE_LOADERS.app;

if (typeof loadSurface !== "function") {
  throw new Error(`No surface entry loader found for "${resolvedSurfaceId}".`);
}

void loadSurface();
