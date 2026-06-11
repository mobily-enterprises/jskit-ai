export {
  createPlacementRegistry
} from "./registry.js";

export {
  definePlacement,
  definePlacementTopology
} from "./validators.js";

export {
  useWebPlacementContext
} from "./inject.js";

export {
  resolveRuntimePathname
} from "./pathname.js";

export {
  readPlacementSurfaceConfig,
  resolveSurfaceDefinitionFromPlacementContext,
  joinSurfacePath,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceRootPathFromPlacementContext,
  resolveSurfacePathFromPlacementContext,
  normalizeSurfaceOrigin,
  resolveSurfaceNavigationTargetFromPlacementContext
} from "./surfaceContext.js";
