function toTrimmedString(value) {
  return String(value ?? "").trim();
}

function toNullableString(value) {
  if (value == null) {
    return null;
  }

  const normalized = toTrimmedString(value);
  return normalized || null;
}

function toBoolean(value, options = {}) {
  if (typeof value === "boolean") {
    return value;
  }

  if (options.coerce) {
    const normalized = toTrimmedString(value).toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }

  throw new Error(String(options.message || "Value must be boolean."));
}

function toEnum(value, allowedValues, options = {}) {
  if (!Array.isArray(allowedValues) || allowedValues.length === 0) {
    throw new Error("allowedValues must be a non-empty array.");
  }

  let normalized = toTrimmedString(value);
  if (options.caseInsensitive) {
    const lower = normalized.toLowerCase();
    const matched = allowedValues.find((entry) => String(entry).toLowerCase() === lower);
    if (matched != null) {
      return String(matched);
    }
  }

  if (allowedValues.includes(normalized)) {
    return normalized;
  }

  if (typeof options.transform === "function") {
    normalized = options.transform(normalized);
    if (allowedValues.includes(normalized)) {
      return normalized;
    }
  }

  throw new Error(String(options.message || "Value is not in the allowed set."));
}

function toPositiveInt(value, options = {}) {
  const min = Number.isInteger(options.min) ? options.min : 1;
  const max = Number.isInteger(options.max) ? options.max : Number.MAX_SAFE_INTEGER;

  const numericValue =
    typeof value === "number" && Number.isInteger(value)
      ? value
      : Number.isFinite(Number(value))
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(numericValue) || numericValue < min || numericValue > max) {
    throw new Error(String(options.message || `Value must be an integer from ${min} to ${max}.`));
  }

  return numericValue;
}

function isValidLocale(value) {
  try {
    new Intl.Locale(value);
    return true;
  } catch {
    return false;
  }
}

function toLocale(value, options = {}) {
  const normalized = toTrimmedString(value);
  if (!normalized) {
    throw new Error(String(options.requiredMessage || "Locale is required."));
  }

  if (!isValidLocale(normalized)) {
    throw new Error(String(options.message || "Locale must be a valid BCP 47 locale tag."));
  }

  return normalized;
}

function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function toTimeZone(value, options = {}) {
  const normalized = toTrimmedString(value);
  if (!normalized) {
    throw new Error(String(options.requiredMessage || "Time zone is required."));
  }

  if (!isValidTimeZone(normalized)) {
    throw new Error(String(options.message || "Time zone must be a valid IANA time zone identifier."));
  }

  return normalized;
}

function isValidCurrencyCode(value) {
  const normalized = toTrimmedString(value).toUpperCase();
  if (!normalized || !/^[A-Z]{3}$/.test(normalized)) {
    return false;
  }

  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("currency").includes(normalized);
  }

  try {
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized
    });
    return true;
  } catch {
    return false;
  }
}

function toCurrencyCode(value, options = {}) {
  const normalized = toTrimmedString(value).toUpperCase();
  if (!normalized) {
    throw new Error(String(options.requiredMessage || "Currency code is required."));
  }

  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error(String(options.patternMessage || "Currency code must be a 3-letter ISO 4217 code."));
  }

  if (!isValidCurrencyCode(normalized)) {
    throw new Error(String(options.message || "Currency code is not supported."));
  }

  return normalized;
}

export {
  isValidCurrencyCode,
  isValidLocale,
  isValidTimeZone,
  toBoolean,
  toCurrencyCode,
  toEnum,
  toLocale,
  toNullableString,
  toPositiveInt,
  toTimeZone,
  toTrimmedString
};
