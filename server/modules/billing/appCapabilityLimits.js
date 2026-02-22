const APP_CAPABILITY_LIMIT_CONFIG = Object.freeze({
  "projects.create": Object.freeze({
    limitationCode: "projects.max",
    usageAmount: 1,
    reasonCode: "project.create",
    entitlementType: "capacity"
  }),
  "projects.unarchive": Object.freeze({
    limitationCode: "projects.max",
    usageAmount: 1,
    reasonCode: "project.unarchive",
    entitlementType: "capacity"
  }),
  "annuity.calculate": Object.freeze({
    limitationCode: "annuity.calculations.monthly",
    usageAmount: 1,
    reasonCode: "annuity.calculate",
    entitlementType: "metered_quota"
  })
});

function normalizeCapability(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function resolveCapabilityLimitConfig(capability) {
  const normalizedCapability = normalizeCapability(capability);
  if (!normalizedCapability) {
    return null;
  }

  return APP_CAPABILITY_LIMIT_CONFIG[normalizedCapability] || null;
}

export { APP_CAPABILITY_LIMIT_CONFIG, resolveCapabilityLimitConfig };
