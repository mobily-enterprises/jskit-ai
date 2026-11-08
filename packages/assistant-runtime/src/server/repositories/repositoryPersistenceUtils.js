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

/**
 * What a repository call keeps of its caller's options: the transaction only. These repositories read in contexts of
 * their own, so the caller's context and settings (a format, missing, returning, fields) never reach their calls. It
 * is resource-runtime's passedOn() without the context, kept here because the file conversation runtime loads these
 * modules without the table runtime.
 * @param {{ trx?: object | null }} [options]
 */
function callerTransaction(options = {}) {
  return options.trx ? { trx: options.trx } : {};
}

export {
  callerTransaction,
  normalizeInputRecordId,
  parseJsonObject,
  stringifyJsonObject,
  toIso,
  toWrittenDateTime
};
