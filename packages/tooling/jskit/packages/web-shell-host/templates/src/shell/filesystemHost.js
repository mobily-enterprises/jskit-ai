import { filesystemRouteEntries, shellEntriesBySurface } from "./generated/filesystemManifest.generated.js";

const SURFACE_PREFIX_BY_ID = Object.freeze({
  app: "",
  admin: "/admin",
  console: "/console"
});

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
  if (!Object.prototype.hasOwnProperty.call(SURFACE_PREFIX_BY_ID, normalized)) {
    return "app";
  }
  return normalized;
}

function resolveSurfaceFromPathname(pathname) {
  const normalizedPath = normalizePath(pathname);
  if (normalizedPath === "/admin" || normalizedPath.startsWith("/admin/")) {
    return "admin";
  }
  if (normalizedPath === "/console" || normalizedPath.startsWith("/console/")) {
    return "console";
  }
  return "app";
}

function listFilesystemRouteEntries() {
  return Array.isArray(filesystemRouteEntries) ? filesystemRouteEntries : [];
}

function listShellEntriesBySlot(surface) {
  const normalizedSurface = normalizeSurface(surface);
  const bySurface = shellEntriesBySurface && typeof shellEntriesBySurface === "object" ? shellEntriesBySurface : {};
  const bySlot = bySurface[normalizedSurface] && typeof bySurface[normalizedSurface] === "object"
    ? bySurface[normalizedSurface]
    : {};

  return Object.freeze({
    drawer: Object.freeze(Array.isArray(bySlot.drawer) ? bySlot.drawer : []),
    top: Object.freeze(Array.isArray(bySlot.top) ? bySlot.top : []),
    config: Object.freeze(Array.isArray(bySlot.config) ? bySlot.config : [])
  });
}

export { listFilesystemRouteEntries, listShellEntriesBySlot, resolveSurfaceFromPathname };
