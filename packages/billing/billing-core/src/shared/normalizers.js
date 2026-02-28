function normalizeCurrency(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function toNonEmptyString(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function toDateOrNull(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function normalizeAmountAllowZero(value, { allowNegative = false } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  if (!allowNegative && parsed < 0) {
    return null;
  }

  return parsed;
}

function normalizeAmountRequireNonZero(value, { allowNegative = false } = {}) {
  const parsed = normalizeAmountAllowZero(value, { allowNegative });
  if (parsed == null || parsed === 0) {
    return null;
  }

  return parsed;
}

function normalizeAmountRequirePositive(value) {
  const parsed = normalizeAmountAllowZero(value);
  if (parsed == null || parsed < 1) {
    return null;
  }

  return parsed;
}

export {
  toNonEmptyString,
  toDateOrNull,
  normalizeCurrency,
  normalizeAmountAllowZero,
  normalizeAmountRequireNonZero,
  normalizeAmountRequirePositive
};
