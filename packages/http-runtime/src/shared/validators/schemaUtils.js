import { isJsonRestSchemaInstance } from "@jskit-ai/kernel/shared/validators";

function asSchema(value, label) {
  if (isJsonRestSchemaInstance(value)) {
    return value;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a schema object.`);
  }

  return value;
}

export { asSchema };
