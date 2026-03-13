import { toInsertDateTime, toNullableDateTime, toIsoString } from "@jskit-ai/database-runtime/shared";
import { isDuplicateEntryError } from "@jskit-ai/database-runtime/shared/duplicateEntry";
import { normalizeText, normalizeLowerText } from "@jskit-ai/kernel/shared/support/normalize";

function nowDb() {
  return toInsertDateTime();
}

function toNullableIso(value) {
  if (!value) {
    return null;
  }
  return toIsoString(value);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)));
}

function parseJson(value, fallback = {}) {
  if (value == null) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function toDbJson(value, fallback = {}) {
  const source = value && typeof value === "object" ? value : fallback;
  return JSON.stringify(source);
}

export {
  toNullableDateTime,
  toIsoString,
  isDuplicateEntryError,
  normalizeText,
  normalizeLowerText,
  nowDb,
  toNullableIso,
  uniqueSorted,
  parseJson,
  toDbJson
};
