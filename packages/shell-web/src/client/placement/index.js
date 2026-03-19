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
} from "./validators.js";

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
  resolveRuntimePathname
} from "./pathname.js";

export {
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACE,
  EMPTY_SURFACE_CONFIG,
  buildSurfaceConfigContext,
  readPlacementSurfaceConfig,
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceSwitchTargetsFromPlacementContext,
  surfaceRequiresWorkspaceFromPlacementContext,
  joinSurfacePath,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceWorkspacesPathFromPlacementContext,
  resolveSurfaceWorkspacePathFromPlacementContext,
  extractWorkspaceSlugFromSurfacePathname,
  resolveSurfaceApiPathFromPlacementContext,
  resolveSurfaceRootPathFromPlacementContext,
  resolveSurfacePathFromPlacementContext
} from "./surfaceContext.js";

export {
  EMPTY_SURFACE_ROLES,
  normalizeSurfaceRole,
  normalizeSurfaceRolesConfig,
  buildSurfaceRolesContext,
  resolveSurfaceIdForRole,
  readPlacementSurfaceRoles
} from "./surfaceRoles.js";
