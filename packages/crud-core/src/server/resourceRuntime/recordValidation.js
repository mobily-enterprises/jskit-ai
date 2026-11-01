import { createValidationError } from "@jskit-ai/kernel/server/runtime/errors";
import { isRecord, normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { codedFieldErrors, validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

function extractExplicitFieldErrors(error) {
  if (isRecord(error?.fieldErrors)) {
    return error.fieldErrors;
  }

  if (isRecord(error?.details?.fieldErrors)) {
    return error.details.fieldErrors;
  }

  return null;
}

async function normalizeRepositoryInputPayload(
  runtime = {},
  payload = {},
  {
    operationKey = "create",
    phase = "crudCreate",
    action = "create",
    recordId = null,
    existingRecord = null,
    actionContextBase = {}
  } = {}
) {
  const input = operationKey === "patch"
    ? runtime.input?.patch
    : runtime.input?.create;
  const normalizedPayload = normalizeObject(payload);

  if (!input) {
    return normalizedPayload;
  }

  try {
    const nextPayload = validateSchemaPayload(input, normalizedPayload, {
      phase: "input",
      context: `${runtime.context || "crudRepository"} operations.${operationKey}.body`
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

async function normalizeRepositoryOutputRecord(runtime = {}, record = {}, { operation = "list" } = {}) {
  try {
    return validateSchemaPayload(runtime.output, record, {
      phase: "output",
      context: `${runtime.context || "crudRepository"} operations.view.output`
    });
  } catch (error) {
    const explicitFieldErrors = extractExplicitFieldErrors(error);
    if (explicitFieldErrors) {
      const detailMessage = Object.entries(explicitFieldErrors)
        .map(([field, message]) => `${field}: ${message}`)
        .join(", ");
      throw new TypeError(
        `${runtime.context || "crudRepository"} ${operation} output validation failed: ${detailMessage}.`
      );
    }
    throw new TypeError(
      `${runtime.context || "crudRepository"} ${operation} output validation failed: ${String(error?.message || "Invalid value.")}.`
    );
  }
}

export {
  normalizeRepositoryInputPayload,
  normalizeRepositoryOutputRecord
};
