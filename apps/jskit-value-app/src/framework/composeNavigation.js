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

function normalizePathname(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "/";
  }

  const withoutTrailingSlash = normalized !== "/" ? normalized.replace(/\/+$/, "") : "/";
  return withoutTrailingSlash || "/";
}

function isPathMatch(pathname, targetPath) {
  const normalizedPathname = normalizePathname(pathname);
  const normalizedTargetPath = normalizePathname(targetPath);
  if (normalizedTargetPath === "/") {
    return normalizedPathname === "/";
  }

  return (
    normalizedPathname === normalizedTargetPath || normalizedPathname.startsWith(`${normalizedTargetPath}/`)
  );
}

function resolveNavigationDestinationTitle(pathname, navigationItems) {
  const items = (Array.isArray(navigationItems) ? navigationItems : [])
    .filter((entry) => entry && typeof entry === "object")
    .sort((left, right) => normalizePathname(right.to).length - normalizePathname(left.to).length);

  for (const item of items) {
    if (isPathMatch(pathname, item.to)) {
      const destinationTitle = String(item.destinationTitle || item.title || "").trim();
      if (destinationTitle) {
        return destinationTitle;
      }
    }
  }

  return "";
}

export { composeNavigationFragments, resolveNavigationDestinationTitle };
