import {
  composeSurfaceRouterOptionsFromModules,
  composeSurfaceRouteFragmentsFromModules
} from "@jskit-ai/web-runtime-core/clientComposition";
import { resolveClientModuleRegistry } from "./moduleRegistry.js";
import { composeSurfaceRouteMounts } from "./composeRouteMounts.js";

const DEFAULTS_BY_SURFACE = Object.freeze({
  app: Object.freeze({
    includeWorkspaceSettings: false,
    includeAssistantRoute: false,
    includeChatRoute: false,
    includeSocialRoute: false,
    includeSocialModerationRoute: false,
    includeChoiceTwoRoute: false
  }),
  admin: Object.freeze({
    includeWorkspaceSettings: false,
    includeAssistantRoute: false,
    includeChatRoute: false,
    includeSocialRoute: false,
    includeSocialModerationRoute: false
  }),
  default: Object.freeze({
    includeWorkspaceSettings: false,
    includeAssistantRoute: false,
    includeChatRoute: false,
    includeSocialRoute: false,
    includeSocialModerationRoute: false,
    includeChoiceTwoRoute: false
  })
});

function composeSurfaceRouterOptions(surface, { enabledModuleIds } = {}) {
  return composeSurfaceRouterOptionsFromModules({
    moduleRegistry: resolveClientModuleRegistry(),
    surface,
    enabledModuleIds,
    defaultsBySurface: DEFAULTS_BY_SURFACE
  });
}

function composeSurfaceRouteFragments(surface, { enabledModuleIds } = {}) {
  const normalizedSurface = String(surface || "").trim().toLowerCase();
  const routeMounts = composeSurfaceRouteMounts(normalizedSurface, {
    enabledModuleIds
  });

  return composeSurfaceRouteFragmentsFromModules({
    moduleRegistry: resolveClientModuleRegistry(),
    surface: normalizedSurface,
    enabledModuleIds,
    routeMounts
  });
}

export { composeSurfaceRouterOptions, composeSurfaceRouteFragments };
