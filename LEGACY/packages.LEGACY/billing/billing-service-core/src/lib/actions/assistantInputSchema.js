function normalizeRequiredEntries(required) {
  return Array.from(
    new Set(
      (Array.isArray(required) ? required : [])
        .map((entry) => String(entry || "").trim())
        .filter(Boolean)
    )
  );
}

function buildAssistantInputJsonSchema({ properties = {}, required = [] } = {}) {
  const normalizedRequired = normalizeRequiredEntries(required);

  return Object.freeze({
    type: "object",
    additionalProperties: false,
    properties,
    ...(normalizedRequired.length > 0
      ? {
          required: normalizedRequired
        }
      : {})
  });
}

export { buildAssistantInputJsonSchema };
