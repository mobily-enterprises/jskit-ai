import {
  composeSurfaceRouterOptionsFromModules,
  composeSurfaceRouteFragmentsFromModules
} from "@jskit-ai/web-runtime-core/clientComposition";
import { resolveClientModuleRegistry } from "./moduleRegistry.js";
import { composeSurfaceRouteMounts } from "./composeRouteMounts.js";
import { buildFilesystemRouteFragment } from "./filesystemContributions.js";

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

  const moduleFragments = composeSurfaceRouteFragmentsFromModules({
    moduleRegistry: resolveClientModuleRegistry(),
    surface: normalizedSurface,
    enabledModuleIds,
    routeMounts
  });

  const filesystemFragment = buildFilesystemRouteFragment(normalizedSurface);
  if (!filesystemFragment) {
    return moduleFragments;
  }

  if (moduleFragments.some((entry) => String(entry?.id || "").trim() === filesystemFragment.id)) {
    throw new Error(`Duplicate route fragment "${filesystemFragment.id}" on surface "${normalizedSurface}".`);
  }

  return Object.freeze(
    [...moduleFragments, filesystemFragment].sort(
      (left, right) =>
        Number(left?.order || 100) - Number(right?.order || 100) ||
        String(left?.id || "").localeCompare(String(right?.id || ""))
    )
  );
}

export { composeSurfaceRouterOptions, composeSurfaceRouteFragments };
