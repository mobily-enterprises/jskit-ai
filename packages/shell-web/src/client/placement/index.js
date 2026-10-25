export {
  createPlacementRegistry
} from "./registry.js";

export {
  definePlacement,
  definePlacementTopology
} from "./validators.js";

export {
  SHELL_WEB_PLACEMENT_RUNTIME_KEY,
  useWebPlacementContext
} from "./inject.js";

export {
  resolveRuntimePathname
} from "./pathname.js";

export {
  readPlacementSurfaceConfig,
  resolveAllowedOriginsFromPlacementContext,
  resolveSurfaceDefinitionFromPlacementContext,
  joinSurfacePath,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceRootPathFromPlacementContext,
  resolveSurfacePathFromPlacementContext,
  normalizeSurfaceOrigin,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "./surfaceContext.js";
