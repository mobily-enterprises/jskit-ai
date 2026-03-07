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
  EMPTY_WEB_PLACEMENT_RUNTIME,
  useWebPlacementRuntime
} from "./placement/index.js";
