function normalizeText(value, { fallback = "" } = {}) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function hasValue(value) {
  if (value == null) {
    return false;
  }

  if (typeof value === "string") {
    return normalizeText(value).length > 0;
  }

  return true;
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }

  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "n") {
    return false;
  }

  throw new TypeError("Boolean field must be true or false.");
}

function normalizeFiniteNumber(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new TypeError("Number field must be a valid number.");
  }
  return normalized;
}

function normalizeFiniteInteger(value) {
  const normalized = normalizeFiniteNumber(value);
  if (!Number.isInteger(normalized)) {
    throw new TypeError("Number field must be an integer.");
  }
  return normalized;
}

function normalizeLowerText(value, { fallback = "" } = {}) {
  return normalizeText(value, {
    fallback
  }).toLowerCase();
}

function normalizeQueryToken(value, { fallback = "__none__" } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || fallback;
}

function normalizeObject(value, { fallback = {} } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }
  return value;
}

function normalizeIfInSource(source, normalized, fieldName, normalizer = (value) => value) {
  if (!isRecord(source)) {
    return normalized;
  }
  if (!isRecord(normalized)) {
    throw new TypeError("normalizeIfInSource requires target object.");
  }

  const normalizedFieldName = normalizeText(fieldName);
  if (!normalizedFieldName) {
    throw new TypeError("normalizeIfInSource requires fieldName.");
  }
  if (typeof normalizer !== "function") {
    throw new TypeError("normalizeIfInSource requires normalizer function.");
  }

  if (!Object.hasOwn(source, normalizedFieldName)) {
    return normalized;
  }

  const sourceValue = source[normalizedFieldName];
  if (sourceValue == null) {
    normalized[normalizedFieldName] = sourceValue;
    return normalized;
  }

  normalized[normalizedFieldName] = normalizer(sourceValue);
  return normalized;
}

function normalizeIfPresent(value, normalizer = (entry) => entry) {
  if (typeof normalizer !== "function") {
    throw new TypeError("normalizeIfPresent requires normalizer function.");
  }
  return value == null ? value : normalizer(value);
}

function normalizeOrNull(value, normalizer = (entry) => entry) {
  if (typeof normalizer !== "function") {
    throw new TypeError("normalizeOrNull requires normalizer function.");
  }
  return value == null ? null : normalizer(value);
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeUniqueTextList(value, { acceptSingle = false } = {}) {
  const source = Array.isArray(value) ? value : acceptSingle ? [value] : [];
  return Array.from(new Set(source.map((entry) => normalizeText(entry)).filter(Boolean)));
}

function normalizeInteger(value, { fallback = 0, min = null, max = null } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  let next = Math.trunc(numeric);
  if (Number.isFinite(min) && next < min) {
    next = min;
  }
  if (Number.isFinite(max) && next > max) {
    next = max;
  }
  return next;
}

function normalizePositiveInteger(value, { fallback = 0 } = {}) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    return fallback;
  }

  return numeric;
}

function normalizeOpaqueId(value, { fallback = null } = {}) {
  if (value == null) {
    return fallback;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || fallback;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "bigint") {
    return String(value);
  }

  return fallback;
}

function normalizeOneOf(value, allowedValues = [], fallback = "") {
  const normalized = normalizeText(value).toLowerCase();
  const supported = Array.isArray(allowedValues)
    ? allowedValues.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean)
    : [];

  if (supported.includes(normalized)) {
    return normalized;
  }

  const normalizedFallback = normalizeText(fallback).toLowerCase();
  if (normalizedFallback) {
    return normalizedFallback;
  }

  return supported[0] || "";
}

function ensureNonEmptyText(value, label = "value") {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }
  return normalized;
}

export {
  normalizeText,
  hasValue,
  normalizeBoolean,
  normalizeFiniteNumber,
  normalizeFiniteInteger,
  normalizeLowerText,
  normalizeQueryToken,
  normalizeObject,
  normalizeIfInSource,
  normalizeIfPresent,
  normalizeOrNull,
  isRecord,
  normalizeArray,
  normalizeUniqueTextList,
  normalizeInteger,
  normalizePositiveInteger,
  normalizeOpaqueId,
  normalizeOneOf,
  ensureNonEmptyText
};
