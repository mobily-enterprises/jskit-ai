export {
  WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN
} from "./tokens.js";

export {
  createPlacementRegistry
} from "./registry.js";

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
  resolveSurfacePathFromPlacementContext
} from "./surfaceContext.js";

export {
  readPlacementSurfaceRoles,
  resolveSurfaceIdForRole
} from "./surfaceRoles.js";
