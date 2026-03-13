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
  normalizeInteger,
  ensureNonEmptyText
};
