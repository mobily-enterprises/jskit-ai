const APP_CAPABILITY_LIMIT_CONFIG = Object.freeze({
  "projects.create": Object.freeze({
    limitationCode: "projects_created_monthly",
    usageAmount: 1
  }),
  "ai.chat.turn": Object.freeze({
    limitationCode: "ai_chat_turns_monthly",
    usageAmount: 1
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
