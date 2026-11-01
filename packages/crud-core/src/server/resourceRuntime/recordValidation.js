import { createValidationError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { codedFieldErrors, errorFieldErrors, validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

/**
 * A create or patch payload validated by the resource's body schema for it, when it has one.
 * @param {import("../types.js").CompiledCrudRepositoryRuntime} runtime
 * @param {object} payload
 * @param {"create" | "patch"} operationKey
 */
async function normalizeRepositoryInputPayload(runtime, payload, operationKey) {
  const input = runtime.input[operationKey];
  const normalizedPayload = normalizeObject(payload);

  if (!input) {
    return normalizedPayload;
  }

  try {
    const nextPayload = validateSchemaPayload(input, normalizedPayload, {
      phase: "input",
      context: `${runtime.context} operations.${operationKey}.body`
    });
    return normalizeObject(nextPayload);
  } catch (error) {
    const fieldErrors = codedFieldErrors(error);
    if (fieldErrors) {
      throw createValidationError(fieldErrors);
    }
    throw error;
  }
}

/**
 * A stored record validated by the resource's view output schema.
 * @param {import("../types.js").CompiledCrudRepositoryRuntime} runtime
 * @param {object} record
 * @param {{ operation: string }} labels The operation its error names.
 */
async function normalizeRepositoryOutputRecord(runtime, record, { operation }) {
  try {
    return validateSchemaPayload(runtime.output, record, {
      phase: "output",
      context: `${runtime.context} operations.view.output`
    });
  } catch (error) {
    const fieldErrors = errorFieldErrors(error)?.fieldErrors;
    if (fieldErrors) {
      const detailMessage = Object.entries(fieldErrors)
        .map(([field, message]) => `${field}: ${message}`)
        .join(", ");
      throw new TypeError(
        `${runtime.context} ${operation} output validation failed: ${detailMessage}.`
      );
    }
    throw new TypeError(
      `${runtime.context} ${operation} output validation failed: ${String(error?.message || "Invalid value.")}.`
    );
  }
}

export {
  normalizeRepositoryInputPayload,
  normalizeRepositoryOutputRecord
};
