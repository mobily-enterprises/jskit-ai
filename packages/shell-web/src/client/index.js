export { ShellWebClientProvider } from "./providers/ShellWebClientProvider.js";

export { default as ShellLayout } from "./components/ShellLayout.vue";
export { default as ShellOutlet } from "./components/ShellOutlet.vue";

export {
  WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN,
  WEB_PLACEMENT_CONTEXT_CONTRIBUTOR_TAG,
  WEB_PLACEMENT_RUNTIME_INJECTION_KEY,
  WEB_PLACEMENT_SURFACE_ANY,
  WEB_PLACEMENT_REGIONS,
  DEFAULT_WEB_PLACEMENT_ORDER,
  definePlacement,
  normalizePlacementDefinition,
  normalizePlacementSlot,
  normalizeSurface,
  createPlacementRegistry,
  createWebPlacementRuntime,
  EMPTY_WEB_PLACEMENT_CONTEXT,
  EMPTY_WEB_PLACEMENT_RUNTIME,
  useWebPlacementRuntime,
  useWebPlacementContext,
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACE,
  EMPTY_SURFACE_CONFIG,
  buildSurfaceConfigContext,
  readPlacementSurfaceConfig,
  resolveSurfaceDefinitionFromPlacementContext,
  surfaceRequiresWorkspaceFromPlacementContext,
  joinSurfacePath,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceWorkspacesPathFromPlacementContext,
  resolveSurfaceWorkspacePathFromPlacementContext,
  extractWorkspaceSlugFromSurfacePathname,
  resolveSurfaceApiPathFromPlacementContext,
  resolveSurfaceRootPathFromPlacementContext,
  resolveSurfacePathFromPlacementContext
} from "./placement/index.js";
