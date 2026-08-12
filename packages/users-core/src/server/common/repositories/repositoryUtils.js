import {
  normalizeDbRecordId,
  toIsoString,
  createWithTransaction
} from "@jskit-ai/database-runtime/shared";
import { isDuplicateEntryError } from "@jskit-ai/database-runtime/shared/duplicateEntry";
import { normalizeLowerText, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

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
  toIsoString,
  isDuplicateEntryError,
  normalizeText,
  normalizeLowerText,
  normalizeRecordId,
  normalizeDbRecordId,
  uniqueSorted,
  parseJson,
  toDbJson,
  createWithTransaction
};
