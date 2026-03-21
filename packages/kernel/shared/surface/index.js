export {
  createSurfaceRegistry,
  normalizeSurfaceId,
  normalizeSurfacePagesRoot,
  deriveSurfaceRouteBaseFromPagesRoot
} from "./registry.js";
export { createSurfacePathHelpers } from "./paths.js";
export {
  createSurfaceRuntime,
  filterRoutesBySurface
} from "./runtime.js";
export { escapeRegExp } from "./escapeRegExp.js";
export {
  API_BASE_PATH,
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
