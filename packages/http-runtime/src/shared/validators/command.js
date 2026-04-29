import { asSchemaDefinition } from "./schemaUtils.js";
import { normalizeUniqueTextList } from "@jskit-ai/kernel/shared/support/normalize";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

function createCommand({
  input,
  output,
  idempotent = null,
  invalidates = []
} = {}) {
  const command = {
    input: asSchemaDefinition(input, "input", "patch"),
    output: asSchemaDefinition(output, "output", "replace"),
    invalidates: Object.freeze(normalizeUniqueTextList(invalidates))
  };

  if (typeof idempotent === "boolean") {
    command.idempotent = idempotent;
  }

  return deepFreeze(command);
}

export { createCommand };
