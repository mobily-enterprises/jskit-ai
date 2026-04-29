import { normalizeSingleSchemaDefinition } from "@jskit-ai/kernel/shared/validators";

function asSchemaDefinition(value, label, defaultMode, { required = true } = {}) {
  if (value == null) {
    if (!required) {
      return null;
    }

    throw new TypeError(`${label} is required.`);
  }

  try {
    return normalizeSingleSchemaDefinition(value, {
      context: label,
      defaultMode
    });
  } catch (error) {
    throw new TypeError(error?.message || `${label} must be a schema definition object.`);
  }
}

export { asSchemaDefinition };
