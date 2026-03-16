function toNonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function createToolArgsSchema(prefixItems = [], { minItems = 0, maxItems = prefixItems.length } = {}) {
  const normalizedPrefixItems = Array.isArray(prefixItems) ? prefixItems.filter(Boolean) : [];
  const normalizedMinItems = toNonNegativeInteger(minItems, 0);
  const normalizedMaxItems = toNonNegativeInteger(maxItems, normalizedPrefixItems.length);

  return Object.freeze({
    type: "object",
    properties: {
      args: {
        type: "array",
        ...(normalizedPrefixItems.length > 0 ? { prefixItems: normalizedPrefixItems } : {}),
        minItems: normalizedMinItems,
        maxItems: Math.max(normalizedMinItems, normalizedMaxItems)
      },
      options: {
        type: "object",
        additionalProperties: true
      }
    },
    additionalProperties: false
  });
}

export { createToolArgsSchema };
