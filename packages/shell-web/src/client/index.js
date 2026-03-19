export {
  ShellWebClientProvider,
  SHELL_WEB_QUERY_CLIENT_TOKEN
} from "./providers/ShellWebClientProvider.js";

export { default as ShellLayout } from "./components/ShellLayout.vue";
export { default as ShellOutlet } from "./components/ShellOutlet.vue";
export { default as ShellErrorHost } from "./components/ShellErrorHost.vue";

export {
  resolveShellLinkPath,
  useShellLinkResolver
} from "./navigation/linkResolver.js";

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
  normalizePlacementSurface,
  createPlacementRegistry,
  createWebPlacementRuntime,
  EMPTY_WEB_PLACEMENT_CONTEXT,
  EMPTY_WEB_PLACEMENT_RUNTIME,
  useWebPlacementRuntime,
  useWebPlacementContext,
  resolveRuntimePathname,
  EMPTY_SURFACE_CONFIG,
  buildSurfaceConfigContext,
  readPlacementSurfaceConfig,
  resolveSurfaceDefinitionFromPlacementContext,
  joinSurfacePath,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceRootPathFromPlacementContext,
  resolveSurfacePathFromPlacementContext,
  EMPTY_SURFACE_ROLES,
  normalizeSurfaceRole,
  normalizeSurfaceRolesConfig,
  buildSurfaceRolesContext,
  resolveSurfaceIdForRole,
  readPlacementSurfaceRoles
} from "./placement/index.js";

export {
  ERROR_CHANNELS,
  ERROR_SEVERITIES,
  createDefaultErrorPolicy,
  createErrorRuntime,
  normalizeErrorEvent,
  PRESENTATION_CHANNELS,
  createErrorPresentationStore,
  MATERIAL_SNACKBAR_PRESENTER_ID,
  MATERIAL_BANNER_PRESENTER_ID,
  MATERIAL_DIALOG_PRESENTER_ID,
  MODULE_DEFAULT_PRESENTER_ID,
  createStoreBackedPresenter,
  createMaterialSnackbarPresenter,
  createMaterialBannerPresenter,
  createMaterialDialogPresenter,
  createDefaultMaterialErrorPresenters,
  SHELL_WEB_ERROR_RUNTIME_CLIENT_TOKEN,
  SHELL_WEB_ERROR_PRESENTATION_STORE_CLIENT_TOKEN,
  SHELL_WEB_ERROR_RUNTIME_INJECTION_KEY,
  SHELL_WEB_ERROR_PRESENTATION_STORE_INJECTION_KEY,
  EMPTY_ERROR_RUNTIME,
  EMPTY_PRESENTATION_STORE,
  EMPTY_PRESENTATION_STATE,
  useShellWebErrorRuntime,
  useShellWebErrorPresentationStore,
  useShellWebErrorPresentationState
} from "./error/index.js";
