function normalizeText(value, { fallback = "" } = {}) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
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
  normalizeLowerText,
  normalizeQueryToken,
  normalizeObject,
  isRecord,
  normalizeArray,
  normalizeUniqueTextList,
  normalizeInteger,
  normalizePositiveInteger,
  normalizeOpaqueId,
  normalizeOneOf,
  ensureNonEmptyText
};
