import { AppError } from "../../lib/errors.js";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateBooleanSchema(value) {
  if (!isObject(value) || typeof value.enabled !== "boolean") {
    return false;
  }

  return Object.keys(value).every((key) => key === "enabled");
}

function validateQuotaSchema(value) {
  if (!isObject(value)) {
    return false;
  }

  const limit = Number(value.limit);
  const interval = String(value.interval || "").trim().toLowerCase();
  const enforcement = String(value.enforcement || "").trim().toLowerCase();

  if (!Number.isInteger(limit) || limit < 0) {
    return false;
  }

  if (!(interval === "day" || interval === "week" || interval === "month" || interval === "year")) {
    return false;
  }

  if (!(enforcement === "hard" || enforcement === "soft")) {
    return false;
  }

  return Object.keys(value).every((key) => key === "limit" || key === "interval" || key === "enforcement");
}

function validateStringListSchema(value) {
  if (!isObject(value) || !Array.isArray(value.values)) {
    return false;
  }

  const normalized = value.values.map((entry) => String(entry || "").trim()).filter(Boolean);
  if (normalized.length !== value.values.length) {
    return false;
  }

  const uniqueCount = new Set(normalized).size;
  if (uniqueCount !== normalized.length) {
    return false;
  }

  return Object.keys(value).every((key) => key === "values");
}

const SCHEMA_VALIDATORS = Object.freeze({
  "entitlement.boolean.v1": validateBooleanSchema,
  "entitlement.quota.v1": validateQuotaSchema,
  "entitlement.string_list.v1": validateStringListSchema
});

function resolveSchemaValidator(schemaVersion) {
  const key = String(schemaVersion || "").trim();
  return SCHEMA_VALIDATORS[key] || null;
}

function validateEntitlementValue({ schemaVersion, value }) {
  const validator = resolveSchemaValidator(schemaVersion);
  if (!validator) {
    return {
      valid: false,
      reason: "unknown_schema_version"
    };
  }

  if (!validator(value)) {
    return {
      valid: false,
      reason: "invalid_payload"
    };
  }

  return {
    valid: true,
    reason: "ok"
  };
}

function assertEntitlementValueOrThrow({ schemaVersion, value, errorStatus = 422 }) {
  const result = validateEntitlementValue({ schemaVersion, value });
  if (result.valid) {
    return;
  }

  const normalizedSchemaVersion = String(schemaVersion || "").trim();
  throw new AppError(errorStatus, "Invalid entitlement payload.", {
    code: "ENTITLEMENT_SCHEMA_INVALID",
    details: {
      schemaVersion: normalizedSchemaVersion,
      reason: result.reason
    }
  });
}

const __testables = {
  isObject,
  validateBooleanSchema,
  validateQuotaSchema,
  validateStringListSchema,
  SCHEMA_VALIDATORS
};

export { resolveSchemaValidator, validateEntitlementValue, assertEntitlementValueOrThrow, __testables };
