import {
  composeNavigationFragmentsFromModules,
  resolveNavigationDestinationTitle as resolveNavigationDestinationTitleCore
} from "@jskit-ai/web-runtime-core/clientComposition";
import { resolveClientModuleRegistry } from "./moduleRegistry.js";
import { composeSurfaceRouteMounts } from "./composeRouteMounts.js";

function composeNavigationFragments(surface, { enabledModuleIds } = {}) {
  const normalizedSurface = String(surface || "").trim().toLowerCase();
  const routeMounts = composeSurfaceRouteMounts(normalizedSurface, {
    enabledModuleIds
  });

  return composeNavigationFragmentsFromModules({
    moduleRegistry: resolveClientModuleRegistry(),
    surface: normalizedSurface,
    enabledModuleIds,
    routeMounts
  });
}

function resolveNavigationDestinationTitle(pathname, navigationItems) {
  return resolveNavigationDestinationTitleCore(pathname, navigationItems);
}

export { composeNavigationFragments, resolveNavigationDestinationTitle };
