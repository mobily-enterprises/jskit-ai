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

export { composeSurfaceRouterOptions };
