import { asSchema } from "./schemaUtils.js";

function normalizeInvalidates(value) {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }

  const normalized = value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  return Object.freeze(Array.from(new Set(normalized)));
}

function createCommand({
  input,
  output,
  idempotent = null,
  invalidates = []
} = {}) {
  const command = {
    input: asSchema(input, "input"),
    output: asSchema(output, "output"),
    invalidates: normalizeInvalidates(invalidates)
  };

  if (typeof idempotent === "boolean") {
    command.idempotent = idempotent;
  }

  return Object.freeze(command);
}

export { createCommand };
