import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { parseJsonObject } from "@jskit-ai/assistant-core/shared";

/** @param {unknown} value */
function normalizeInputRecordId(value) {
  return normalizeRecordId(value, { fallback: null });
}

/** @param {unknown} value */
function stringifyJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return JSON.stringify(value);
}

/** @param {unknown} value */
function toIso(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(/** @type {string | number} */ (value));
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

/**
 * A date-time a repository writes: the caller's value as ISO text, or now.
 * @param {unknown} [value]
 */
function toWrittenDateTime(value = null) {
  return (value ? new Date(/** @type {string | number | Date} */ (value)) : new Date()).toISOString();
}

export {
  normalizeInputRecordId,
  parseJsonObject,
  stringifyJsonObject,
  toIso,
  toWrittenDateTime
};
