export { createSurfaceRegistry, normalizeSurfaceId } from "../../shared/surface/registry.js";
export { createSurfacePathHelpers } from "../../shared/surface/paths.js";
export { createSurfaceRuntime, filterRoutesBySurface } from "../../shared/surface/runtime.js";
export { escapeRegExp } from "../../shared/surface/escapeRegExp.js";
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
} from "../../shared/surface/apiPaths.js";
export { SurfaceRoutingServiceProvider } from "./SurfaceRoutingServiceProvider.js";
