import { mergeObjectSchemas } from "./mergeObjectSchemas.js";
import { isRecord as isPlainObject } from "../support/normalize.js";

function isPromiseLike(value) {
  return Boolean(value) && typeof value.then === "function";
}

function createErrorFactory(createError) {
  if (typeof createError === "function") {
    return createError;
  }

  return (message) => new Error(message);
}

function mergeValidators(validators = [], options = {}) {
  const sourceValidators = Array.isArray(validators) ? validators : [];
  const context = String(options?.context || "validator").trim() || "validator";
  const requireSchema = options?.requireSchema === true;
  const allowAsyncNormalize = options?.allowAsyncNormalize !== false;
  const requiredSchemaMessage = String(options?.requiredSchemaMessage || `${context}.schema is required.`);
  const normalizeResultMessage = String(options?.normalizeResultMessage || `${context}.normalize must return an object.`);
  const makeError = createErrorFactory(options?.createError);
  const schemas = [];
  const modes = [];
  const normalizers = [];

  for (const validator of sourceValidators) {
    if (!isPlainObject(validator)) {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(validator, "schema")) {
      schemas.push(validator.schema);
    }

    if (typeof validator.mode === "string" && validator.mode.trim()) {
      modes.push(validator.mode.trim().toLowerCase());
    }

    if (typeof validator.normalize === "function") {
      normalizers.push(validator.normalize);
    }
  }

  if (requireSchema && schemas.length < 1) {
    throw makeError(requiredSchemaMessage);
  }

  const merged = {};
  if (schemas.length === 1) {
    merged.schema = schemas[0];
  } else if (schemas.length > 1) {
    merged.schema = mergeObjectSchemas(schemas);
  }

  if (modes.length === 1) {
    merged.mode = modes[0];
  } else if (modes.length > 1) {
    const [firstMode, ...restModes] = modes;
    const consistentMode = restModes.every((entry) => entry === firstMode);
    if (consistentMode) {
      merged.mode = firstMode;
    }
  }

  if (normalizers.length === 1) {
    merged.normalize = normalizers[0];
  } else if (normalizers.length > 1) {
    if (allowAsyncNormalize) {
      merged.normalize = async function normalizeMergedValidators(payload, meta) {
        const normalized = {};

        for (const normalizer of normalizers) {
          const result = await normalizer(payload, meta);
          if (!isPlainObject(result)) {
            throw makeError(normalizeResultMessage);
          }
          Object.assign(normalized, result);
        }

        return normalized;
      };
    } else {
      merged.normalize = function normalizeMergedValidators(payload, meta) {
        const normalized = {};

        for (const normalizer of normalizers) {
          const result = normalizer(payload, meta);
          if (isPromiseLike(result) || !isPlainObject(result)) {
            throw makeError(normalizeResultMessage);
          }
          Object.assign(normalized, result);
        }

        return normalized;
      };
    }
  }

  return Object.freeze(merged);
}

export { mergeValidators };
