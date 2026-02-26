import { resolveClientModuleRegistry } from "./moduleRegistry.js";

function resolveActiveClientModules(enabledModuleIds) {
  if (!Array.isArray(enabledModuleIds) || enabledModuleIds.length < 1) {
    return resolveClientModuleRegistry();
  }

  const enabledSet = new Set(enabledModuleIds.map((entry) => String(entry || "").trim()).filter(Boolean));
  return resolveClientModuleRegistry().filter((entry) => enabledSet.has(entry.id));
}

function composeNavigationFragments(surface, { enabledModuleIds } = {}) {
  const normalizedSurface = String(surface || "").trim().toLowerCase();
  const fragments = [];

  for (const moduleEntry of resolveActiveClientModules(enabledModuleIds)) {
    const contributions = moduleEntry?.client?.navigation?.[normalizedSurface];
    for (const contribution of Array.isArray(contributions) ? contributions : []) {
      fragments.push({
        ...contribution,
        moduleId: moduleEntry.id
      });
    }
  }

  return fragments;
}

export { composeNavigationFragments };
