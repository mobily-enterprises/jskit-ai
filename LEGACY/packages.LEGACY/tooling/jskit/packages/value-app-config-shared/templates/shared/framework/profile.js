const FRAMEWORK_PROFILE_IDS = Object.freeze({
  webSaasDefault: "web-saas-default"
});

const WEB_SAAS_OPTIONAL_SERVER_MODULE_PACKS = Object.freeze({
  core: Object.freeze([]),
  social: Object.freeze(["social"]),
  billing: Object.freeze(["billing"]),
  ai: Object.freeze(["ai"]),
  collaboration: Object.freeze(["history", "communications", "settings", "alerts", "consoleErrors", "chat", "projects"]),
  calculator: Object.freeze(["deg2rad"]),
  security: Object.freeze(["securityAudit"])
});

const WEB_SAAS_OPTIONAL_CLIENT_MODULE_PACKS = Object.freeze({
  core: Object.freeze([]),
  social: Object.freeze(["social"]),
  billing: Object.freeze(["billing"]),
  ai: Object.freeze(["ai"]),
  collaboration: Object.freeze(["projects", "settings", "alerts", "history", "chat"])
});

const WEB_SAAS_DEFAULT_PROFILE = Object.freeze({
  id: FRAMEWORK_PROFILE_IDS.webSaasDefault,
  requiredServerModules: Object.freeze(["observability", "auth", "workspace", "console", "health", "actionRuntime"]),
  optionalServerModules: Object.freeze([
    "history",
    "communications",
    "settings",
    "alerts",
    "consoleErrors",
    "securityAudit",
    "ai",
    "chat",
    "projects",
    "billing",
    "social",
    "deg2rad"
  ]),
  optionalServerModulePacks: WEB_SAAS_OPTIONAL_SERVER_MODULE_PACKS,
  requiredClientModules: Object.freeze(["auth", "workspace", "console", "deg2rad"]),
  optionalClientModules: Object.freeze(["ai", "projects", "settings", "alerts", "history", "billing", "chat", "social"]),
  optionalClientModulePacks: WEB_SAAS_OPTIONAL_CLIENT_MODULE_PACKS
});

const FRAMEWORK_PROFILES = Object.freeze({
  [FRAMEWORK_PROFILE_IDS.webSaasDefault]: WEB_SAAS_DEFAULT_PROFILE
});

function resolveFrameworkProfile(profileId = FRAMEWORK_PROFILE_IDS.webSaasDefault) {
  const normalized = String(profileId || "").trim();
  return FRAMEWORK_PROFILES[normalized] || FRAMEWORK_PROFILES[FRAMEWORK_PROFILE_IDS.webSaasDefault];
}

function normalizeOptionalModulePacks(optionalModulePacks) {
  if (optionalModulePacks == null) {
    return null;
  }

  const rawEntries = Array.isArray(optionalModulePacks)
    ? optionalModulePacks
    : String(optionalModulePacks || "")
        .split(",")
        .map((entry) => String(entry || "").trim());

  const normalized = [];
  const seen = new Set();

  for (const rawEntry of rawEntries) {
    const normalizedEntry = String(rawEntry || "")
      .trim()
      .replace(/^\+/, "")
      .toLowerCase();
    if (!normalizedEntry || seen.has(normalizedEntry)) {
      continue;
    }
    seen.add(normalizedEntry);
    normalized.push(normalizedEntry);
  }

  return normalized;
}

function resolveOptionalModulesFromPacks(optionalModules, optionalModulePacksById, optionalModulePacks) {
  const normalizedPacks = normalizeOptionalModulePacks(optionalModulePacks);
  if (normalizedPacks == null || normalizedPacks.length < 1 || normalizedPacks.includes("all")) {
    return optionalModules;
  }

  const selectedModules = new Set();
  for (const packId of normalizedPacks) {
    const packModules = optionalModulePacksById?.[packId];
    if (!Array.isArray(packModules)) {
      throw new TypeError(`Unknown optional module pack "${packId}".`);
    }
    for (const moduleId of packModules) {
      const normalizedModuleId = String(moduleId || "").trim();
      if (normalizedModuleId) {
        selectedModules.add(normalizedModuleId);
      }
    }
  }

  return optionalModules.filter((moduleId) => selectedModules.has(moduleId));
}

function resolveServerModuleIdsForProfile(profile, { optionalModulePacks } = {}) {
  const profileValue = profile && typeof profile === "object" ? profile : resolveFrameworkProfile();
  const optionalModules = resolveOptionalModulesFromPacks(
    profileValue.optionalServerModules,
    profileValue.optionalServerModulePacks,
    optionalModulePacks
  );

  return Object.freeze([...profileValue.requiredServerModules, ...optionalModules]);
}

function resolveClientModuleIdsForProfile(profile, { optionalModulePacks } = {}) {
  const profileValue = profile && typeof profile === "object" ? profile : resolveFrameworkProfile();
  const optionalModules = resolveOptionalModulesFromPacks(
    profileValue.optionalClientModules,
    profileValue.optionalClientModulePacks,
    optionalModulePacks
  );

  return Object.freeze([...profileValue.requiredClientModules, ...optionalModules]);
}

export {
  FRAMEWORK_PROFILE_IDS,
  FRAMEWORK_PROFILES,
  WEB_SAAS_DEFAULT_PROFILE,
  resolveFrameworkProfile,
  normalizeOptionalModulePacks,
  resolveServerModuleIdsForProfile,
  resolveClientModuleIdsForProfile
};
