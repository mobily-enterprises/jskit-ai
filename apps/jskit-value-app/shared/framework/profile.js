const FRAMEWORK_PROFILE_IDS = Object.freeze({
  webSaasDefault: "web-saas-default"
});

const WEB_SAAS_DEFAULT_PROFILE = Object.freeze({
  id: FRAMEWORK_PROFILE_IDS.webSaasDefault,
  requiredServerModules: Object.freeze([
    "observability",
    "auth",
    "workspace",
    "console",
    "health",
    "actionRuntime"
  ]),
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
  requiredClientModules: Object.freeze(["auth", "workspace", "console", "deg2rad"]),
  optionalClientModules: Object.freeze([
    "ai",
    "projects",
    "settings",
    "alerts",
    "history",
    "billing",
    "chat",
    "social"
  ])
});

const FRAMEWORK_PROFILES = Object.freeze({
  [FRAMEWORK_PROFILE_IDS.webSaasDefault]: WEB_SAAS_DEFAULT_PROFILE
});

function resolveFrameworkProfile(profileId = FRAMEWORK_PROFILE_IDS.webSaasDefault) {
  const normalized = String(profileId || "").trim();
  return FRAMEWORK_PROFILES[normalized] || FRAMEWORK_PROFILES[FRAMEWORK_PROFILE_IDS.webSaasDefault];
}

export { FRAMEWORK_PROFILE_IDS, FRAMEWORK_PROFILES, WEB_SAAS_DEFAULT_PROFILE, resolveFrameworkProfile };
