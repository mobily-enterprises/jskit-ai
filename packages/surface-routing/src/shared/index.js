export { createSurfaceRegistry, normalizeSurfaceId } from "./registry.js";
export { createSurfacePathHelpers } from "./paths.js";
export {
  API_BASE_PATH,
  API_MAJOR_VERSION,
  API_VERSION_SEGMENT,
  API_PREFIX,
  API_PREFIX_SLASH,
  API_DOCS_PATH,
  API_REALTIME_PATH,
  normalizePathname,
  isApiPath,
  isVersionedApiPath,
  toVersionedApiPath,
  toVersionedApiPrefix,
  buildVersionedApiPath,
  isVersionedApiPrefixMatch
} from "./apiPaths.js";
export {
  DEFAULT_SURFACES,
  DEFAULT_ROUTES,
  createDefaultAppSurfaceRegistry,
  createDefaultAppSurfacePaths
} from "./appSurfaces.js";
