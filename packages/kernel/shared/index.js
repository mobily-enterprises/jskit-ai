export { KERNEL_TOKENS } from "./support/tokens.js";
export { formatDateTime } from "./support/formatDateTime.js";
export {
  normalizeText,
  normalizeQueryToken,
  normalizeObject,
  isRecord,
  normalizeArray,
  normalizeInteger,
  ensureNonEmptyText
} from "./support/normalize.js";
export { isExternalLinkTarget, splitPathQueryHash, resolveLinkPath } from "./support/linkPath.js";
export { sortStrings, sortById } from "./support/sorting.js";
export { normalizeObjectInput } from "./validators/inputNormalization.js";
export {
  normalizeRequiredFieldList,
  deriveRequiredFieldsFromSchema,
  deriveResourceRequiredMetadata
} from "./validators/resourceRequiredMetadata.js";

export { createSurfaceRegistry, normalizeSurfaceId } from "./surface/registry.js";
export { createSurfacePathHelpers } from "./surface/paths.js";
export { createSurfaceRuntime, filterRoutesBySurface } from "./surface/runtime.js";
export { escapeRegExp } from "./surface/escapeRegExp.js";
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
} from "./surface/apiPaths.js";
export {
  DEFAULT_SURFACES,
  DEFAULT_ROUTES,
  createDefaultAppSurfaceRegistry,
  createDefaultAppSurfacePaths
} from "./surface/appSurfaces.js";
