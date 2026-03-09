function normalizeRequiredFields(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return Object.freeze([]);
  }

  const required = Array.isArray(schema.required) ? schema.required : [];
  const normalized = required
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  return Object.freeze(Array.from(new Set(normalized)));
}

function buildResourceRequiredMetadata({
  create,
  replace,
  patch
} = {}) {
  return Object.freeze({
    create: normalizeRequiredFields(create),
    replace: normalizeRequiredFields(replace),
    patch: normalizeRequiredFields(patch)
  });
}

function normalizeObjectInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return {
    ...value
  };
}

export {
  normalizeRequiredFields,
  buildResourceRequiredMetadata,
  normalizeObjectInput
};
