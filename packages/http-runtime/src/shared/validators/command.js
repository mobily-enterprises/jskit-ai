import { asSchema } from "./schemaUtils.js";
import { normalizeUniqueTextList } from "@jskit-ai/kernel/shared/support/normalize";

function createCommand({
  input,
  output,
  idempotent = null,
  invalidates = []
} = {}) {
  const command = {
    input: asSchema(input, "input"),
    output: asSchema(output, "output"),
    invalidates: Object.freeze(normalizeUniqueTextList(invalidates))
  };

  if (typeof idempotent === "boolean") {
    command.idempotent = idempotent;
  }

  return Object.freeze(command);
}

export { createCommand };
