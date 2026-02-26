import { resolveClientModuleRegistry } from "./moduleRegistry.js";

const APP_SURFACE_DEFAULTS = Object.freeze({
  includeWorkspaceSettings: false,
  includeAssistantRoute: false,
  includeChatRoute: false,
  includeSocialRoute: false,
  includeSocialModerationRoute: false,
  includeChoiceTwoRoute: false
});

const ADMIN_SURFACE_DEFAULTS = Object.freeze({
  includeWorkspaceSettings: false,
  includeAssistantRoute: false,
  includeChatRoute: false,
  includeSocialRoute: false,
  includeSocialModerationRoute: false
});

function resolveActiveClientModules(enabledModuleIds) {
  if (!Array.isArray(enabledModuleIds) || enabledModuleIds.length < 1) {
    return resolveClientModuleRegistry();
  }

  const enabledSet = new Set(enabledModuleIds.map((entry) => String(entry || "").trim()).filter(Boolean));
  return resolveClientModuleRegistry().filter((entry) => enabledSet.has(entry.id));
}

function composeSurfaceRouterOptions(surface, { enabledModuleIds } = {}) {
  const normalizedSurface = String(surface || "").trim().toLowerCase();
  const base = normalizedSurface === "admin" ? { ...ADMIN_SURFACE_DEFAULTS } : { ...APP_SURFACE_DEFAULTS };

  for (const moduleEntry of resolveActiveClientModules(enabledModuleIds)) {
    const contribution = moduleEntry?.client?.router?.[normalizedSurface];
    if (!contribution || typeof contribution !== "object") {
      continue;
    }

    for (const [key, value] of Object.entries(contribution)) {
      if (!Object.hasOwn(base, key)) {
        continue;
      }
      base[key] = Boolean(value);
    }
  }

  return base;
}

function composeSurfaceRouteFragments(surface, { enabledModuleIds } = {}) {
  const normalizedSurface = String(surface || "").trim().toLowerCase();
  const fragments = [];
  const claimedFragmentIds = new Set();

  for (const moduleEntry of resolveActiveClientModules(enabledModuleIds)) {
    const contributedFragments = moduleEntry?.client?.routeFragments?.[normalizedSurface];
    for (const contribution of Array.isArray(contributedFragments) ? contributedFragments : []) {
      if (!contribution || typeof contribution !== "object") {
        continue;
      }

      const id = String(contribution.id || "").trim();
      if (!id) {
        continue;
      }
      if (claimedFragmentIds.has(id)) {
        throw new Error(`Duplicate client route fragment "${id}" on surface "${normalizedSurface}".`);
      }

      if (typeof contribution.createRoutes !== "function") {
        throw new TypeError(`Route fragment "${id}" must define createRoutes().`);
      }

      claimedFragmentIds.add(id);
      fragments.push(
        Object.freeze({
          id,
          order: Number.isFinite(contribution.order) ? Number(contribution.order) : 100,
          createRoutes: contribution.createRoutes,
          options:
            contribution.options && typeof contribution.options === "object" && !Array.isArray(contribution.options)
              ? Object.freeze({ ...contribution.options })
              : Object.freeze({})
        })
      );
    }
  }

  return Object.freeze(fragments.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)));
}

export { composeSurfaceRouterOptions, composeSurfaceRouteFragments };
