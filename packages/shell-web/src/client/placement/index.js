export {
  WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN,
  WEB_PLACEMENT_CONTEXT_CONTRIBUTOR_TAG,
  WEB_PLACEMENT_RUNTIME_INJECTION_KEY,
  WEB_PLACEMENT_SURFACE_ANY,
  DEFAULT_WEB_PLACEMENT_ORDER,
  WEB_PLACEMENT_REGIONS
} from "./tokens.js";

export {
  normalizePlacementDefinition,
  definePlacement,
  normalizePlacementSlot,
  normalizeSurface
} from "./contracts.js";

export {
  createPlacementRegistry
} from "./registry.js";

export {
  createWebPlacementRuntime
} from "./runtime.js";

export {
  EMPTY_WEB_PLACEMENT_RUNTIME,
  EMPTY_WEB_PLACEMENT_CONTEXT,
  useWebPlacementRuntime,
  useWebPlacementContext
} from "./inject.js";

export {
  EMPTY_SURFACE_CONFIG,
  buildSurfaceConfigContext,
  readPlacementSurfaceConfig,
  resolveSurfaceDefinitionFromPlacementContext,
  surfaceRequiresWorkspaceFromPlacementContext,
  joinSurfacePath,
  resolveSurfaceRootPathFromPlacementContext,
  resolveSurfacePathFromPlacementContext
} from "./surfaceContext.js";
