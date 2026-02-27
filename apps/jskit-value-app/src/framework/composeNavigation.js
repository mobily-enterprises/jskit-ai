import {
  composeNavigationFragmentsFromModules,
  resolveNavigationDestinationTitle as resolveNavigationDestinationTitleCore
} from "@jskit-ai/web-runtime-core/clientComposition";
import { resolveClientModuleRegistry } from "./moduleRegistry.js";
import { composeSurfaceRouteMounts } from "./composeRouteMounts.js";
import { listFilesystemNavigationFragments } from "./filesystemContributions.js";

function composeNavigationFragments(surface, { enabledModuleIds } = {}) {
  const normalizedSurface = String(surface || "").trim().toLowerCase();
  const routeMounts = composeSurfaceRouteMounts(normalizedSurface, {
    enabledModuleIds
  });

  const moduleNavigationFragments = composeNavigationFragmentsFromModules({
    moduleRegistry: resolveClientModuleRegistry(),
    surface: normalizedSurface,
    enabledModuleIds,
    routeMounts
  });

  const filesystemNavigationFragments = listFilesystemNavigationFragments(normalizedSurface);
  if (filesystemNavigationFragments.length < 1) {
    return moduleNavigationFragments;
  }

  const claimedIds = new Set(
    moduleNavigationFragments.map((entry) => String(entry?.id || "").trim()).filter(Boolean)
  );
  for (const entry of filesystemNavigationFragments) {
    const id = String(entry?.id || "").trim();
    if (!id) {
      continue;
    }
    if (claimedIds.has(id)) {
      throw new Error(`Duplicate navigation fragment "${id}" on surface "${normalizedSurface}".`);
    }
    claimedIds.add(id);
  }

  return [...moduleNavigationFragments, ...filesystemNavigationFragments].sort(
    (left, right) =>
      Number(left?.order || 100) - Number(right?.order || 100) ||
      String(left?.id || "").localeCompare(String(right?.id || ""))
  );
}

function resolveNavigationDestinationTitle(pathname, navigationItems) {
  return resolveNavigationDestinationTitleCore(pathname, navigationItems);
}

export { composeNavigationFragments, resolveNavigationDestinationTitle };
