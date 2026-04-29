import { normalizeObjectInput } from "./inputNormalization.js";

function normalizeValidator(validator) {
  if (!validator || typeof validator !== "object" || Array.isArray(validator)) {
    return null;
  }

  if (!Object.hasOwn(validator, "schema")) {
    return null;
  }

  return validator;
}

function nestValidator(key, validator, { required = true } = {}) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    throw new TypeError("nestValidator requires a non-empty key.");
  }

  const normalizedValidator = normalizeValidator(validator);
  if (!normalizedValidator) {
    throw new TypeError(`nestValidator(\"${normalizedKey}\") requires a validator object with schema.`);
  }

  const properties = {
    [normalizedKey]: normalizedValidator.schema
  };
  const schema = {
    type: "object",
    additionalProperties: false,
    properties,
    ...(required ? { required: [normalizedKey] } : {})
  };
  const normalizeSection = typeof normalizedValidator.normalize === "function" ? normalizedValidator.normalize : null;

  return Object.freeze({
    schema,
    async normalize(payload, meta) {
      const source = normalizeObjectInput(payload);
      if (!Object.hasOwn(source, normalizedKey)) {
        return {};
      }

      const sectionPayload = source[normalizedKey];
      const normalizedSection = normalizeSection ? await normalizeSection(sectionPayload, meta) : sectionPayload;
      return {
        [normalizedKey]: normalizedSection
      };
    }
  });
}

export { nestValidator };
