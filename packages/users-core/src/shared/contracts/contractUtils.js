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

function createOperationMessages({
  fields = {},
  keywords = {},
  defaultMessage = "Invalid value.",
  validationMessage = "Validation failed."
} = {}) {
  return Object.freeze({
    apiValidation: String(validationMessage || "Validation failed."),
    fields: Object.freeze({
      ...(fields && typeof fields === "object" ? fields : {})
    }),
    keywords: Object.freeze({
      additionalProperties: "Unexpected field.",
      ...(keywords && typeof keywords === "object" ? keywords : {})
    }),
    default: String(defaultMessage || "Invalid value.")
  });
}

export {
  normalizeRequiredFields,
  buildResourceRequiredMetadata,
  normalizeObjectInput,
  createOperationMessages
};
