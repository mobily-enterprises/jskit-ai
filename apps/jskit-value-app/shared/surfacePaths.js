import { createDefaultAppSurfacePaths } from "@jskit-ai/surface-routing/appSurfaces";

const {
  SURFACE_ADMIN,
  SURFACE_APP,
  SURFACE_CONSOLE,
  ADMIN_SURFACE_PREFIX,
  CONSOLE_SURFACE_PREFIX,
  normalizePathname,
  matchesPathPrefix,
  resolveSurfaceFromApiPathname,
  resolveSurfaceFromPathname,
  resolveSurfacePrefix,
  withSurfacePrefix,
  createSurfacePaths,
  resolveSurfacePaths
} = createDefaultAppSurfacePaths();

export {
  SURFACE_ADMIN,
  SURFACE_APP,
  SURFACE_CONSOLE,
  ADMIN_SURFACE_PREFIX,
  CONSOLE_SURFACE_PREFIX,
  normalizePathname,
  matchesPathPrefix,
  resolveSurfaceFromApiPathname,
  resolveSurfaceFromPathname,
  resolveSurfacePrefix,
  withSurfacePrefix,
  createSurfacePaths,
  resolveSurfacePaths
};
